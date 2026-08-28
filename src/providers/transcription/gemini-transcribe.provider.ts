import { GoogleGenAI } from "@google/genai";
import { ProviderError } from "@/domain/errors";
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

    try {
      // 1. Upload audio to Gemini Files API
      // Create a Blob from the Buffer for the Files API
      const audioBlob: Blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
      const fileUploadResult = await this.client.files.upload({
        file: audioBlob,
      });

      uploadedFileName = fileUploadResult.name;

      // 2. Execute Transcription interaction with verbatim mode & word-level timestamps
      const response = await this.client.models.generateContent({
        model: this.modelName,
        contents: [
          {
            role: "user",
            parts: [
              {
                fileData: {
                  fileUri: fileUploadResult.uri,
                  mimeType: fileUploadResult.mimeType || mimeType,
                },
              },
              {
                text: "Transcribe the spoken audio verbatim. Return word-level timestamps.",
              },
            ],
          },
        ],
        config: {
          // Gemini 3.5 Transcribe configuration
          responseMimeType: "application/json",
        },
      });

      const responseText = response.text || "";
      let parsedData: Record<string, unknown> | null = null;

      try {
        parsedData = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        // If the model did not return structured JSON, check candidates/parts for annotations
        parsedData = response as unknown as Record<string, unknown>;
      }

      // 3. Extract word timestamps and text
      const rawWords: RawTranscriptionWord[] = [];
      let detectedLanguage: string | null = null;
      let displayText = "";

      if (parsedData && Array.isArray(parsedData.words)) {
        displayText = typeof parsedData.text === "string" ? parsedData.text : "";
        detectedLanguage = typeof parsedData.language === "string" ? parsedData.language : null;
        for (const item of parsedData.words) {
          const w = item as Record<string, unknown>;
          const text = String(w.text || w.word || "").trim();
          if (!text) continue;

          // Parse start and end timestamps (which may be in seconds, ms, or timestamp strings)
          const startMs = this.normalizeTimestampToMs(w.start ?? w.startMs ?? w.startTime);
          const endMs = this.normalizeTimestampToMs(w.end ?? w.endMs ?? w.endTime);

          rawWords.push({
            text,
            startMs,
            endMs,
            speaker: typeof w.speaker === "string" ? w.speaker : null,
            confidence: typeof w.confidence === "number" ? w.confidence : null,
          });
        }
      } else if (parsedData && Array.isArray(parsedData.candidates)) {
        // Fallback extraction from candidates/parts
        const candidate = parsedData.candidates[0] as {
          content?: { parts?: Array<{ text?: string }> };
        } | undefined;
        const textContent =
          candidate?.content?.parts?.map((p) => p.text || "").join(" ") || "";
        displayText = textContent.trim();
        // If no explicit word timestamps were returned, this is a malformed timestamp failure
        throw new ProviderError(
          this.id,
          "Gemini transcription response is missing required word-level timestamp annotations",
          { code: "MISSING_TIMESTAMPS" }
        );
      } else {
        throw new ProviderError(
          this.id,
          "Gemini transcription response is structurally malformed",
          { code: "MALFORMED_RESPONSE" }
        );
      }

      // Handle NO_SPEECH
      if (rawWords.length === 0) {
        if (parsedData?.noSpeech === true || displayText === "") {
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
          "Gemini transcription returned non-empty text but zero valid word timestamps",
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
      const message =
        err instanceof Error
          ? err.message
          : typeof error.message === "string"
            ? error.message
            : "Gemini transcription request failed";

      let code = "UPSTREAM_UNAVAILABLE";
      if (status === 400) code = "INVALID_REQUEST";
      else if (status === 401) code = "AUTH_FAILED";
      else if (status === 403) code = "FORBIDDEN";
      else if (status === 404) code = "MODEL_UNAVAILABLE";
      else if (status === 429) code = "RATE_LIMITED";
      else if (
        (err instanceof Error && err.name === "AbortError") ||
        message.includes("timeout")
      )
        code = "TIMEOUT";
      else if (message.includes("fetch failed") || message.includes("network"))
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

      throw new ProviderError(this.id, `Gemini transcription failed (${code}): ${message}`, {
        code,
        status,
        provider: this.id,
      });
    } finally {
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

  private normalizeTimestampToMs(value: unknown): number {
    if (typeof value === "number") {
      // If value is in seconds (floating point < 1000 for realistic speech phrase), convert to ms
      // If value is already integer milliseconds (e.g. 1500), keep as is
      return Number.isInteger(value) && value > 10000
        ? value
        : Math.round(value * (value < 1000 ? 1000 : 1));
    }
    if (typeof value === "string") {
      if (value.endsWith("s")) {
        const sec = parseFloat(value.slice(0, -1));
        return Math.round(sec * 1000);
      }
      const num = parseFloat(value);
      return Number.isFinite(num) ? Math.round(num * 1000) : 0;
    }
    return 0;
  }
}
