import { GoogleGenAI } from "@google/genai";
import { ProviderError, ValidationError } from "@/domain/errors";
import {
  buildCanonicalTranscript,
  assertValidTranscriptionWords,
  type RawTranscriptionWord,
  type TranscriptionResult,
  type TranscriptionProviderId,
} from "@/domain/transcription";
import type {
  TranscriptionInput,
  TranscriptionProvider,
} from "./transcription-provider.interface";
import type { Logger } from "@/infrastructure/logging/logger";
import { normalizeProviderError } from "./provider-error-normalizer";

export interface GeminiTranscribeProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  logger?: Logger;
  genAiClient?: GoogleGenAI;
  fetchFn?: typeof fetch;
}

/**
 * Parses fractional timestamp strings like "0.100s", "1.250s", "62.003s" or numeric seconds into milliseconds.
 */
function parseTimestampOffsetToMs(offset: unknown): number | null {
  if (typeof offset === "number" && !isNaN(offset)) {
    return Math.round(offset * 1000);
  }
  if (typeof offset === "string") {
    const trimmed = offset.trim();
    if (trimmed.endsWith("s")) {
      const num = parseFloat(trimmed.slice(0, -1));
      if (!isNaN(num)) return Math.round(num * 1000);
    }
    const num = parseFloat(trimmed);
    if (!isNaN(num)) return Math.round(num * 1000);
  }
  return null;
}

export class GeminiTranscribeProvider implements TranscriptionProvider {
  readonly id: TranscriptionProviderId = "gemini-transcribe";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;
  private readonly client: GoogleGenAI | null = null;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiTranscribeProviderOptions = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.GEMINI_API_KEY || "");
    this.modelName = options.model || process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe";
    this.timeoutMs = options.timeoutMs || 45000;
    this.logger = options.logger;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;

    if (options.genAiClient) {
      this.client = options.genAiClient;
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.id,
        "Gemini transcription is not configured.",
        { code: "UNCONFIGURED", provider: this.id }
      );
    }

    const { audioBuffer, mimeType, projectId, audioSourceId, requestedMode } = input;
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new ProviderError(this.id, "Gemini transcription input is invalid.", {
        code: "INVALID_INPUT",
        provider: this.id,
      });
    }

    const startTime = Date.now();
    let uploadedFileName: string | undefined;
    let uploadedFileUri: string | undefined;

    // Single request-scoped AbortController bounding the entire logical attempt
    const attemptAbortController = new AbortController();
    let isDeadlineExpired = false;

    const deadlineTimer = setTimeout(() => {
      isDeadlineExpired = true;
      attemptAbortController.abort(new Error("DEADLINE_EXCEEDED"));
    }, this.timeoutMs);

    try {
      // 1. Upload audio buffer via Google GenAI Files API with genuine transport-level cancellation
      const uint8 = new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
      const blob = new Blob([uint8 as unknown as BlobPart], { type: mimeType });

      if (this.client) {
        const clientAny = this.client as unknown as Record<string, unknown>;
        const clientFiles = clientAny.files as {
          upload?: (params: unknown, options?: unknown) => Promise<{ name?: string; uri?: string; mimeType?: string }>;
        } | undefined;

        if (!clientFiles || typeof clientFiles.upload !== "function") {
          throw new ProviderError(this.id, "Gemini transcription service is unavailable.", {
            code: "UPSTREAM_UNAVAILABLE",
            provider: this.id,
          });
        }

        try {
          const uploadedFile = await clientFiles.upload(
            { file: blob, mimeType },
            { signal: attemptAbortController.signal }
          );
          uploadedFileName = uploadedFile.name;
          uploadedFileUri = uploadedFile.uri;
        } catch (uploadErr: unknown) {
          if (attemptAbortController.signal.aborted || isDeadlineExpired) {
            throw new ProviderError(this.id, "Gemini transcription timed out.", {
              code: "TIMEOUT",
              provider: this.id,
            });
          }
          throw uploadErr;
        }
      } else {
        // Direct REST upload with native AbortSignal
        const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(
          this.apiKey
        )}`;
        const formData = new FormData();
        formData.append("file", blob, "audio");

        let uploadResponse: Response;
        try {
          uploadResponse = await this.fetchFn(uploadUrl, {
            method: "POST",
            headers: {
              "x-goog-api-key": this.apiKey,
            },
            body: formData,
            signal: attemptAbortController.signal,
          });
        } catch (fetchErr: unknown) {
          if (attemptAbortController.signal.aborted || isDeadlineExpired) {
            throw new ProviderError(this.id, "Gemini transcription timed out.", {
              code: "TIMEOUT",
              provider: this.id,
            });
          }
          throw fetchErr;
        }

        if (!uploadResponse.ok) {
          throw new ProviderError(
            this.id,
            uploadResponse.status === 401
              ? "Gemini transcription authentication failed."
              : "Gemini transcription service is unavailable.",
            { code: uploadResponse.status === 401 ? "AUTH_FAILED" : "UPSTREAM_UNAVAILABLE", status: uploadResponse.status, provider: this.id }
          );
        }

        const uploadJson = (await uploadResponse.json()) as { file?: { name?: string; uri?: string } };
        uploadedFileName = uploadJson.file?.name;
        uploadedFileUri = uploadJson.file?.uri;
      }

      if (!uploadedFileName) {
        throw new ProviderError(this.id, "Gemini transcription returned a malformed response.", {
          code: "MALFORMED_RESPONSE",
          provider: this.id,
        });
      }

      // Check remaining deadline budget before interactions.create
      const elapsedSoFarMs = Date.now() - startTime;
      if (elapsedSoFarMs >= this.timeoutMs || attemptAbortController.signal.aborted || isDeadlineExpired) {
        throw new ProviderError(this.id, "Gemini transcription timed out.", {
          code: "TIMEOUT",
          provider: this.id,
        });
      }

      // 2. Execute Transcription interaction with verbatim mode & word-level timestamps ONLY
      const fileUri = uploadedFileUri || uploadedFileName;
      let rawInteraction: Record<string, unknown>;

      if (this.client) {
        const clientAny = this.client as unknown as Record<string, unknown>;
        const clientInteractions = clientAny.interactions as {
          create?: (params: unknown, options?: unknown) => Promise<Record<string, unknown>>;
        } | undefined;

        if (!clientInteractions || typeof clientInteractions.create !== "function") {
          throw new ProviderError(this.id, "Gemini transcription service is unavailable.", {
            code: "UPSTREAM_UNAVAILABLE",
            provider: this.id,
          });
        }

        try {
          rawInteraction = await clientInteractions.create(
            {
              model: this.modelName,
              input: [
                {
                  type: "audio",
                  file_uri: fileUri,
                  mime_type: mimeType,
                },
              ],
              generation_config: {
                transcription_config: {
                  mode: {
                    type: "verbatim",
                    timestamp_granularities: ["word"],
                  },
                },
              },
            },
            { signal: attemptAbortController.signal }
          );
        } catch (interactionErr: unknown) {
          if (attemptAbortController.signal.aborted || isDeadlineExpired) {
            throw new ProviderError(this.id, "Gemini transcription timed out.", {
              code: "TIMEOUT",
              provider: this.id,
            });
          }
          throw interactionErr;
        }
      } else {
        // Direct REST Interactions API call with native AbortSignal
        const interactionUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(
          this.apiKey
        )}`;

        let interactionResponse: Response;
        try {
          interactionResponse = await this.fetchFn(interactionUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": this.apiKey,
            },
            body: JSON.stringify({
              model: this.modelName,
              input: [
                {
                  type: "audio",
                  file_uri: fileUri,
                  mime_type: mimeType,
                },
              ],
              generation_config: {
                transcription_config: {
                  mode: {
                    type: "verbatim",
                    timestamp_granularities: ["word"],
                  },
                },
              },
            }),
            signal: attemptAbortController.signal,
          });
        } catch (fetchErr: unknown) {
          if (attemptAbortController.signal.aborted || isDeadlineExpired) {
            throw new ProviderError(this.id, "Gemini transcription timed out.", {
              code: "TIMEOUT",
              provider: this.id,
            });
          }
          throw fetchErr;
        }

        if (!interactionResponse.ok) {
          throw new ProviderError(
            this.id,
            interactionResponse.status === 401
              ? "Gemini transcription authentication failed."
              : "Gemini transcription service is unavailable.",
            { code: interactionResponse.status === 401 ? "AUTH_FAILED" : "UPSTREAM_UNAVAILABLE", status: interactionResponse.status, provider: this.id }
          );
        }

        rawInteraction = (await interactionResponse.json()) as Record<string, unknown>;
      }

      // 3. Parse canonical word timestamps exclusively from interaction.steps[].content[].annotations[]
      const rawWords: RawTranscriptionWord[] = [];
      let topLevelDisplayText = "";
      const detectedLocale: string | null = null;

      if (typeof rawInteraction.output_text === "string") {
        topLevelDisplayText = rawInteraction.output_text;
      } else if (typeof rawInteraction.text === "string") {
        topLevelDisplayText = rawInteraction.text;
      }

      const steps = Array.isArray(rawInteraction.steps) ? rawInteraction.steps : [];
      for (const step of steps) {
        if (!step || typeof step !== "object") continue;
        const contents = Array.isArray(step.content) ? step.content : [step.content];

        for (const content of contents) {
          if (!content || typeof content !== "object") continue;

          if (!topLevelDisplayText && typeof content.text === "string") {
            topLevelDisplayText = content.text;
          }

          const annotations = Array.isArray(content.annotations) ? content.annotations : [];
          for (const ann of annotations) {
            if (!ann || typeof ann !== "object") continue;

            const isWordInfo =
              ann.type === "word_info" ||
              ann.annotation_type === "word_info" ||
              ann.word_info !== undefined ||
              ann.word !== undefined;

            if (isWordInfo) {
              const wordObj = ann.word_info || ann;
              const text = String(wordObj.word || wordObj.text || "").trim();
              const startMs = parseTimestampOffsetToMs(wordObj.start_offset ?? wordObj.start_time ?? wordObj.start);
              const endMs = parseTimestampOffsetToMs(wordObj.end_offset ?? wordObj.end_time ?? wordObj.end);

              if (text && startMs !== null && endMs !== null) {
                if (endMs < startMs) {
                  throw new ValidationError(`Malformed timestamp: endMs (${endMs}) is earlier than startMs (${startMs})`);
                }

                rawWords.push({
                  text,
                  startMs,
                  endMs,
                  confidence: typeof wordObj.confidence === "number" ? wordObj.confidence : null,
                  speaker: wordObj.speaker_id || wordObj.speaker ? String(wordObj.speaker_id || wordObj.speaker) : null,
                  locale: wordObj.language_code || detectedLocale || null,
                });
              }
            }
          }
        }
      }

      // 4. Handle NO_SPEECH vs MISSING_TIMESTAMPS
      if (rawWords.length === 0) {
        if (!topLevelDisplayText || topLevelDisplayText.trim().length === 0) {
          return {
            provider: this.id,
            model: this.modelName,
            requestedMode,
            displayText: "",
            canonicalText: "",
            detectedLanguage: null,
            durationMs: 0,
            wordCount: 0,
            words: [],
            noSpeech: true,
          };
        }

        throw new ProviderError(
          this.id,
          "Gemini transcription is missing word-level timestamps.",
          { code: "MISSING_TIMESTAMPS", provider: this.id }
        );
      }

      // 5. Invariant assertion
      try {
        assertValidTranscriptionWords(rawWords);
      } catch {
        throw new ProviderError(
          this.id,
          "Gemini transcription returned a malformed response.",
          { code: "MALFORMED_RESPONSE", provider: this.id }
        );
      }

      // 6. Build canonical transcript and exact UTF-16 slices
      const canonical = buildCanonicalTranscript(rawWords);
      const lastWord = rawWords[rawWords.length - 1];
      const durationMs = lastWord ? lastWord.endMs : 0;
      const elapsedMs = Date.now() - startTime;

      this.logger?.info({
        event: "transcription.gemini_success",
        projectId,
        audioSourceId,
        provider: this.id,
        model: this.modelName,
        wordCount: canonical.words.length,
        durationMs,
        elapsedMs,
      });

      return {
        provider: this.id,
        model: this.modelName,
        requestedMode,
        displayText: topLevelDisplayText || canonical.canonicalText,
        canonicalText: canonical.canonicalText,
        detectedLanguage: detectedLocale,
        durationMs,
        wordCount: canonical.words.length,
        words: canonical.words,
      };
    } catch (err: unknown) {
      if (attemptAbortController.signal.aborted || isDeadlineExpired) {
        throw new ProviderError(this.id, "Gemini transcription timed out.", {
          code: "TIMEOUT",
          provider: this.id,
        });
      }

      const normalized = normalizeProviderError(this.id, err);
      const code = (normalized.details as { code?: string })?.code || "UPSTREAM_UNAVAILABLE";

      this.logger?.warn({
        event: "transcription.gemini_failed",
        projectId,
        audioSourceId,
        provider: this.id,
        model: this.modelName,
        code,
        elapsedMs: Date.now() - startTime,
      });

      throw normalized;
    } finally {
      clearTimeout(deadlineTimer);

      // Best-effort bounded remote file cleanup in finally
      if (uploadedFileName) {
        const cleanupController = new AbortController();
        const cleanupTimer = setTimeout(() => cleanupController.abort(), 5000);

        try {
          if (this.client) {
            const clientAny = this.client as unknown as Record<string, unknown>;
            const clientFiles = clientAny.files as {
              delete?: (params: { name: string }, options?: unknown) => Promise<unknown>;
            } | undefined;

            if (clientFiles && typeof clientFiles.delete === "function") {
              await clientFiles.delete(
                { name: uploadedFileName },
                { signal: cleanupController.signal }
              );
            }
          } else {
            const deleteUrl = `https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}?key=${encodeURIComponent(
              this.apiKey
            )}`;
            await this.fetchFn(deleteUrl, {
              method: "DELETE",
              headers: { "x-goog-api-key": this.apiKey },
              signal: cleanupController.signal,
            });
          }
        } catch {
          this.logger?.warn({
            event: "transcription.cleanup_failed",
            provider: this.id,
            category: cleanupController.signal.aborted ? "CLEANUP_TIMEOUT" : "CLEANUP_ERROR",
          });
        } finally {
          clearTimeout(cleanupTimer);
        }
      }
    }
  }
}
