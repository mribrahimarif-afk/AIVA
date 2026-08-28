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
  fetchFn?: typeof fetch;
}

const DURATION_REGEX = /^\d+(?:\.\d+)?s$/;

/**
 * Strict parser for Google duration string offsets (e.g. "0s", "0.100s", "1.250s", "62.003s").
 * Rejects prefixes, suffixes, exponents, negative signs, missing units, and malformed strings.
 */
export function parseTimestampOffsetToMs(offset: unknown): number | null {
  if (typeof offset !== "string") {
    return null;
  }
  if (!DURATION_REGEX.test(offset)) {
    return null;
  }
  const secStr = offset.slice(0, -1);
  const sec = Number(secStr);
  if (!Number.isFinite(sec) || isNaN(sec) || sec < 0) {
    return null;
  }
  return Math.round(sec * 1000);
}

export class GeminiTranscribeProvider implements TranscriptionProvider {
  readonly id: TranscriptionProviderId = "gemini-transcribe";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiTranscribeProviderOptions = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.GEMINI_API_KEY || "");
    this.modelName = options.model || process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe";
    this.timeoutMs = options.timeoutMs || 45000;
    this.logger = options.logger;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
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
      // =========================================================================
      // 1. Official Gemini Resumable Upload Sequence: Start Request
      // =========================================================================
      const startUrl = "https://generativelanguage.googleapis.com/upload/v1beta/files";
      let startResponse: Response;

      try {
        startResponse = await this.fetchFn(startUrl, {
          method: "POST",
          headers: {
            "x-goog-api-key": this.apiKey,
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": String(audioBuffer.byteLength),
            "X-Goog-Upload-Header-Content-Type": mimeType,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            file: {
              display_name: "audio_input",
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

      if (!startResponse.ok) {
        throw new ProviderError(
          this.id,
          startResponse.status === 401
            ? "Gemini transcription authentication failed."
            : "Gemini transcription service is unavailable.",
          {
            code: startResponse.status === 401 ? "AUTH_FAILED" : "UPSTREAM_UNAVAILABLE",
            status: startResponse.status,
            provider: this.id,
          }
        );
      }

      // Extract official upload URL from response header (case-insensitive)
      const uploadUrl = startResponse.headers.get("x-goog-upload-url");
      if (!uploadUrl || uploadUrl.trim().length === 0) {
        throw new ProviderError(this.id, "Gemini transcription returned a malformed response.", {
          code: "MALFORMED_RESPONSE",
          provider: this.id,
        });
      }

      // Check remaining deadline budget before upload/finalize
      const elapsedAfterStartMs = Date.now() - startTime;
      if (elapsedAfterStartMs >= this.timeoutMs || attemptAbortController.signal.aborted || isDeadlineExpired) {
        throw new ProviderError(this.id, "Gemini transcription timed out.", {
          code: "TIMEOUT",
          provider: this.id,
        });
      }

      // =========================================================================
      // 2. Official Gemini Resumable Upload Sequence: Upload Bytes + Finalize
      // =========================================================================
      let finalizeResponse: Response;
      try {
        finalizeResponse = await this.fetchFn(uploadUrl, {
          method: "POST",
          headers: {
            "Content-Length": String(audioBuffer.byteLength),
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
          },
          body: audioBuffer as unknown as BodyInit,
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

      if (!finalizeResponse.ok) {
        throw new ProviderError(
          this.id,
          finalizeResponse.status === 401
            ? "Gemini transcription authentication failed."
            : "Gemini transcription service is unavailable.",
          {
            code: finalizeResponse.status === 401 ? "AUTH_FAILED" : "UPSTREAM_UNAVAILABLE",
            status: finalizeResponse.status,
            provider: this.id,
          }
        );
      }

      const finalizeJson = (await finalizeResponse.json()) as {
        file?: { name?: string; uri?: string; mimeType?: string };
        name?: string;
        uri?: string;
      };

      uploadedFileName = finalizeJson.file?.name || finalizeJson.name;
      uploadedFileUri = finalizeJson.file?.uri || finalizeJson.uri;

      if (!uploadedFileName || !uploadedFileUri) {
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

      // =========================================================================
      // 3. Interactions Request with Verbatim Mode & Word-Level Granularity
      // =========================================================================
      const interactionUrl = "https://generativelanguage.googleapis.com/v1beta/interactions";
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
                file_uri: uploadedFileUri,
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
          {
            code: interactionResponse.status === 401 ? "AUTH_FAILED" : "UPSTREAM_UNAVAILABLE",
            status: interactionResponse.status,
            provider: this.id,
          }
        );
      }

      const rawInteraction = (await interactionResponse.json()) as Record<string, unknown>;

      // =========================================================================
      // 4. Strict Authoritative Parsing of word_info Annotations ONLY
      // =========================================================================
      const rawWords: RawTranscriptionWord[] = [];
      let topLevelDisplayText = "";

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

            // Strict contract: ONLY annotation.type === "word_info" accepted
            if (ann.type !== "word_info") continue;

            const text = typeof ann.text === "string" ? ann.text.trim() : "";
            if (!text) continue;

            const startMs = parseTimestampOffsetToMs(ann.start_offset);
            const endMs = parseTimestampOffsetToMs(ann.end_offset);

            if (startMs === null || endMs === null) {
              throw new ValidationError(`Malformed timestamp offset: start=${ann.start_offset}, end=${ann.end_offset}`);
            }

            if (endMs < startMs) {
              throw new ValidationError(`Malformed timestamp: endMs (${endMs}) is earlier than startMs (${startMs})`);
            }

            rawWords.push({
              text,
              startMs,
              endMs,
              confidence: typeof ann.confidence === "number" ? ann.confidence : null,
              speaker: typeof ann.speaker === "string" ? ann.speaker : null,
              locale: null,
            });
          }
        }
      }

      // =========================================================================
      // 5. Handle NO_SPEECH vs MISSING_TIMESTAMPS
      // =========================================================================
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

      // 6. Invariant assertion
      try {
        assertValidTranscriptionWords(rawWords);
      } catch {
        throw new ProviderError(
          this.id,
          "Gemini transcription returned a malformed response.",
          { code: "MALFORMED_RESPONSE", provider: this.id }
        );
      }

      // 7. Build canonical transcript and exact UTF-16 slices
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
        detectedLanguage: null,
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
          const deleteTarget = uploadedFileName.startsWith("files/")
            ? uploadedFileName
            : `files/${uploadedFileName}`;
          const deleteUrl = `https://generativelanguage.googleapis.com/v1beta/${deleteTarget}`;

          await this.fetchFn(deleteUrl, {
            method: "DELETE",
            headers: { "x-goog-api-key": this.apiKey },
            signal: cleanupController.signal,
          });
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
