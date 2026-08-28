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

export interface GeminiTranscribeProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  logger?: Logger;
  genAiClient?: GoogleGenAI;
}

/**
 * Strips secrets, file paths, and raw JSON bodies from provider error messages.
 */
function sanitizeErrorMessage(rawMessage: string): string {
  let msg = rawMessage;
  // Strip API keys
  msg = msg.replace(/\b(?:AIza|sk-|ghp_|AKIA|xoxb)[A-Za-z0-9\-_]{8,}\b/g, "[REDACTED]");
  msg = msg.replace(/((?:api[-_]?key|key|secret|token)\s*[:=]\s*)([^\s"'&,;]+)/gi, "$1[REDACTED]");
  // Strip local absolute file paths (Windows & POSIX)
  msg = msg.replace(/[A-Za-z]:\\[^:\s"'<>]+\.[A-Za-z0-9]+/g, "[FILE_PATH]");
  msg = msg.replace(/\/(?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+\.[A-Za-z0-9]+/g, "[FILE_PATH]");
  // Truncate long raw json payloads
  if (msg.length > 250) {
    msg = msg.substring(0, 250) + "...";
  }
  return msg;
}

export class GeminiTranscribeProvider implements TranscriptionProvider {
  readonly id: TranscriptionProviderId = "gemini-transcribe";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;
  private readonly client: GoogleGenAI | null = null;

  constructor(options: GeminiTranscribeProviderOptions = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.GEMINI_API_KEY || "");
    this.modelName = options.model || process.env.GEMINI_TRANSCRIBE_MODEL || "gemini-3.5-transcribe";
    this.timeoutMs = options.timeoutMs || 45000;
    this.logger = options.logger;

    if (options.genAiClient) {
      this.client = options.genAiClient;
    } else if (this.apiKey.trim().length > 0) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey.trim() });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (!this.isConfigured() || !this.client) {
      throw new ProviderError(
        this.id,
        "Gemini Transcription is not configured. GEMINI_API_KEY is missing or blank.",
        { code: "UNCONFIGURED", provider: this.id }
      );
    }

    const { audioBuffer, mimeType, projectId, audioSourceId, requestedMode } = input;
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new ProviderError(this.id, "Audio buffer is empty", { code: "INVALID_INPUT" });
    }

    const startTime = Date.now();
    let uploadedFileName: string | undefined;

    // Overall request-scoped abort controller and deadline
    const abortController = new AbortController();
    let isTimedOut = false;
    const timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      abortController.abort();
    }, this.timeoutMs);

    try {
      // 1. Upload audio buffer via Google GenAI Files API
      const uint8 = new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
      const blob = new Blob([uint8 as unknown as BlobPart], { type: mimeType });
      const uploadedFile = await this.client.files.upload({
        file: blob,
      });
      uploadedFileName = uploadedFile.name;

      if (!uploadedFileName) {
        throw new ProviderError(this.id, "Gemini Files upload did not return a valid file identifier", {
          code: "MALFORMED_RESPONSE",
        });
      }

      // Check deadline budget before interactions.create
      const elapsedSoFarMs = Date.now() - startTime;
      if (elapsedSoFarMs >= this.timeoutMs || abortController.signal.aborted) {
        throw new ProviderError(this.id, `Gemini transcription request exceeded deadline of ${this.timeoutMs}ms`, {
          code: "TIMEOUT",
        });
      }

      // 2. Execute Transcription interaction with verbatim mode & word-level timestamps ONLY
      const clientAny = this.client as unknown as Record<string, unknown>;

      if (
        !clientAny.interactions ||
        typeof (clientAny.interactions as { create?: unknown }).create !== "function"
      ) {
        throw new ProviderError(
          this.id,
          "Gemini 3.5 Transcribe Interactions API is not available on GenAI client. Canonical transcription requires interactions.create.",
          { code: "UPSTREAM_UNAVAILABLE" }
        );
      }

      const interactionPromise = (
        clientAny.interactions as {
          create: (params: unknown) => Promise<Record<string, unknown>>;
        }
      ).create({
        model: this.modelName,
        input: [
          {
            type: "audio",
            file_uri: uploadedFile.uri,
            mime_type: uploadedFile.mimeType || mimeType,
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
      });

      const response = await Promise.race([
        interactionPromise,
        new Promise<never>((_, reject) => {
          abortController.signal.addEventListener("abort", () => {
            reject(new ProviderError(this.id, "Gemini transcription interaction timed out", { code: "TIMEOUT" }));
          });
        }),
      ]);

      // 3. Extract word timestamps and text STRICTLY from official interaction structure
      const rawWords: RawTranscriptionWord[] = [];
      let detectedLanguage: string | null = null;
      let displayText = "";

      if (typeof response.output_text === "string") {
        displayText = response.output_text;
      } else if (typeof response.text === "string") {
        displayText = response.text;
      }

      if (typeof response.language === "string") {
        detectedLanguage = response.language;
      }

      // Official Gemini 3.5 Transcribe format: interaction.steps[].content[].annotations[]
      const steps = Array.isArray(response.steps)
        ? response.steps
        : Array.isArray((response as { interaction?: { steps?: unknown[] } }).interaction?.steps)
          ? ((response as { interaction: { steps: unknown[] } }).interaction.steps as unknown[])
          : null;

      if (!steps || !Array.isArray(steps) || steps.length === 0) {
        // If output_text is empty or noSpeech is signaled
        if (response.noSpeech === true || displayText.trim() === "") {
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
          "Gemini transcription interaction returned no steps/content annotations for spoken audio",
          { code: "MISSING_TIMESTAMPS" }
        );
      }

      for (const stepItem of steps) {
        const step = stepItem as { content?: unknown[] };
        if (!Array.isArray(step?.content)) continue;

        for (const contentItem of step.content) {
          const content = contentItem as { annotations?: unknown[]; text?: string };
          if (typeof content?.text === "string" && !displayText) {
            displayText = content.text;
          }

          if (!Array.isArray(content?.annotations)) continue;

          for (const annotationItem of content.annotations) {
            const ann = annotationItem as Record<string, unknown>;
            if (ann?.type === "word_info") {
              const text = String(ann.text ?? "").trim();
              if (!text) continue;

              const startMs = this.parseOffsetToMs(
                ann.start_offset ?? ann.startOffset ?? ann.start
              );
              const endMs = this.parseOffsetToMs(
                ann.end_offset ?? ann.endOffset ?? ann.end
              );

              if (startMs === null || endMs === null) {
                throw new ProviderError(
                  this.id,
                  `Malformed or missing timestamp offset in Gemini word_info annotation: start=${String(ann.start_offset)}, end=${String(ann.end_offset)}`,
                  { code: "MALFORMED_RESPONSE" }
                );
              }

              if (endMs < startMs) {
                throw new ProviderError(
                  this.id,
                  `Invalid timing in Gemini word_info annotation: end (${endMs}ms) < start (${startMs}ms)`,
                  { code: "MALFORMED_RESPONSE" }
                );
              }

              rawWords.push({
                text,
                startMs,
                endMs,
                speaker: typeof ann.speaker === "string" ? ann.speaker : null,
                confidence: typeof ann.confidence === "number" ? ann.confidence : null,
              });
            }
          }
        }
      }

      // Handle NO_SPEECH
      if (rawWords.length === 0) {
        if (response.noSpeech === true || displayText.trim() === "") {
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
          "Gemini transcription returned non-empty text but zero valid word_info timestamp annotations",
          { code: "MISSING_TIMESTAMPS" }
        );
      }

      // 4. Validate word timing invariants
      assertValidTranscriptionWords(rawWords);

      // 5. Build canonical transcript and exact UTF-16 slices
      const canonical = buildCanonicalTranscript(rawWords);
      const lastWord = rawWords[rawWords.length - 1];
      const durationMs = lastWord ? lastWord.endMs : 0;
      const elapsedMs = Date.now() - startTime;

      if (!displayText) {
        displayText = canonical.canonicalText;
      }

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
        displayText,
        canonicalText: canonical.canonicalText,
        detectedLanguage,
        durationMs,
        wordCount: canonical.words.length,
        words: canonical.words,
      };
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        throw err;
      }
      if (err instanceof ValidationError) {
        throw new ProviderError(this.id, err.message, { code: "MALFORMED_RESPONSE" });
      }

      const error =
        typeof err === "object" && err !== null
          ? (err as Record<string, unknown>)
          : {};
      const status =
        typeof error.status === "number"
          ? error.status
          : typeof error.statusCode === "number"
            ? error.statusCode
            : typeof error.httpStatus === "number"
              ? error.httpStatus
              : undefined;
      const rawMessage =
        err instanceof Error
          ? err.message
          : typeof error.message === "string"
            ? error.message
            : "Gemini transcription request failed";

      const sanitizedMessage = sanitizeErrorMessage(rawMessage);

      let code = "UPSTREAM_UNAVAILABLE";
      if (status === 400) code = "INVALID_REQUEST";
      else if (status === 401) code = "AUTH_FAILED";
      else if (status === 403) code = "FORBIDDEN";
      else if (status === 404) code = "MODEL_UNAVAILABLE";
      else if (status === 429) code = "RATE_LIMITED";
      else if (
        isTimedOut ||
        (err instanceof Error && err.name === "AbortError") ||
        rawMessage.toLowerCase().includes("timeout")
      )
        code = "TIMEOUT";
      else if (rawMessage.toLowerCase().includes("fetch failed") || rawMessage.toLowerCase().includes("network"))
        code = "NETWORK_FAILURE";

      this.logger?.warn({
        event: "transcription.gemini_failed",
        projectId,
        audioSourceId,
        provider: this.id,
        code,
        status,
        elapsedMs: Date.now() - startTime,
      });

      throw new ProviderError(this.id, `Gemini transcription failed (${code}): ${sanitizedMessage}`, {
        code,
        status,
        provider: this.id,
      });
    } finally {
      clearTimeout(timeoutHandle);
      // 6. Explicit best-effort cleanup of remote Gemini file in finally
      if (uploadedFileName && this.client) {
        try {
          await this.client.files.delete({ name: uploadedFileName });
        } catch {
          // File deletion failure must not fail the accepted result or throw
        }
      }
    }
  }

  /**
   * Parses official Gemini duration strings (e.g. "0.100s", "1.250s", "0s") or numeric seconds
   * deterministically into milliseconds. Rejects missing, negative, NaN, or non-finite values.
   */
  private parseOffsetToMs(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0) return null;
      return Number.isInteger(value) && value > 10000
        ? value
        : Math.round(value * (value < 1000 ? 1000 : 1));
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      const match = trimmed.match(/^(\d+(?:\.\d+)?)s$/);
      if (match && match[1]) {
        const sec = parseFloat(match[1]);
        if (!Number.isFinite(sec) || sec < 0) return null;
        return Math.round(sec * 1000);
      }
      const sec = parseFloat(trimmed);
      if (!Number.isFinite(sec) || sec < 0) return null;
      return Math.round(sec * (trimmed.endsWith("s") || sec < 1000 ? 1000 : 1));
    }
    return null;
  }
}
