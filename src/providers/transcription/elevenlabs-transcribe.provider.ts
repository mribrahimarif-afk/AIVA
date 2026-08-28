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
import { normalizeProviderError } from "./provider-error-normalizer";

export interface ElevenLabsTranscribeProviderOptions {
  apiKey?: string;
  enabled?: boolean;
  modelId?: string;
  timeoutMs?: number;
  logger?: Logger;
  fetchFn?: typeof fetch;
}

export class ElevenLabsTranscribeProvider implements TranscriptionProvider {
  readonly id: TranscriptionProviderId = "elevenlabs-scribe";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;
  private readonly fetchFn: typeof fetch;

  constructor(options: ElevenLabsTranscribeProviderOptions = {}) {
    this.enabled =
      options.enabled ?? (process.env.ELEVENLABS_STT_ENABLED === "true");
    this.apiKey =
      options.apiKey !== undefined
        ? options.apiKey
        : (process.env.ELEVENLABS_STT_API_KEY || process.env.ELEVENLABS_API_KEY || "");
    this.modelName =
      options.modelId || process.env.ELEVENLABS_STT_MODEL_ID || "scribe_v2";
    this.timeoutMs =
      options.timeoutMs || Number(process.env.ELEVENLABS_STT_TIMEOUT_MS) || 45000;
    this.logger = options.logger;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.enabled && this.apiKey && this.apiKey.trim().length > 0);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (!this.enabled) {
      throw new ProviderError(
        this.id,
        "ElevenLabs transcription is currently disabled.",
        { code: "DISABLED", provider: this.id }
      );
    }

    if (!this.apiKey || this.apiKey.trim().length === 0) {
      throw new ProviderError(
        this.id,
        "ElevenLabs transcription is not configured.",
        { code: "UNCONFIGURED", provider: this.id }
      );
    }

    const { audioBuffer, mimeType, projectId, audioSourceId, requestedMode } = input;
    const startTime = Date.now();

    try {
      const formData = new FormData();
      const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
      formData.append("file", audioBlob, "audio");
      formData.append("model_id", this.modelName);
      formData.append("timestamps_granularity", "word");
      formData.append("tag_audio_events", "false");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response;
      try {
        response = await this.fetchFn("https://api.elevenlabs.io/v1/speech-to-text", {
          method: "POST",
          headers: {
            "xi-api-key": this.apiKey,
          },
          body: formData,
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) {
          throw new ProviderError(this.id, "ElevenLabs transcription timed out.", {
            code: "TIMEOUT",
            provider: this.id,
          });
        }
        throw new ProviderError(this.id, "ElevenLabs transcription network failure.", {
          code: "NETWORK_FAILURE",
          provider: this.id,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        let code = "UPSTREAM_UNAVAILABLE";
        if (response.status === 400) code = "INVALID_REQUEST";
        else if (response.status === 401) code = "AUTH_FAILED";
        else if (response.status === 403) code = "FORBIDDEN";
        else if (response.status === 404) code = "MODEL_UNAVAILABLE";
        else if (response.status === 429) code = "RATE_LIMITED";

        throw new ProviderError(
          this.id,
          code === "AUTH_FAILED"
            ? "ElevenLabs transcription authentication failed."
            : code === "RATE_LIMITED"
              ? "ElevenLabs transcription is temporarily rate limited."
              : "ElevenLabs transcription service is unavailable.",
          { code, status: response.status, provider: this.id }
        );
      }

      const data = await response.json();
      const displayText = data.text || "";
      const detectedLanguage = data.language_code || null;
      const rawWords: RawTranscriptionWord[] = [];

      if (Array.isArray(data.words)) {
        for (const w of data.words) {
          if (!w.text || typeof w.start !== "number" || typeof w.end !== "number") continue;
          rawWords.push({
            text: String(w.text).trim(),
            startMs: Math.round(w.start * 1000),
            endMs: Math.round(w.end * 1000),
            speaker: w.speaker_id || null,
          });
        }
      }

      if (rawWords.length === 0) {
        if (!displayText || displayText.trim().length === 0) {
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
          "ElevenLabs transcription is missing word-level timestamps.",
          { code: "MISSING_TIMESTAMPS", provider: this.id }
        );
      }

      assertValidTranscriptionWords(rawWords);
      const canonical = buildCanonicalTranscript(rawWords);
      const lastWord = rawWords[rawWords.length - 1];
      const durationMs = lastWord ? lastWord.endMs : 0;
      const elapsedMs = Date.now() - startTime;

      this.logger?.info({
        event: "transcription.elevenlabs_success",
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
        displayText: displayText || canonical.canonicalText,
        canonicalText: canonical.canonicalText,
        detectedLanguage,
        durationMs,
        wordCount: canonical.words.length,
        words: canonical.words,
      };
    } catch (err: unknown) {
      const normalized = normalizeProviderError(this.id, err);
      const code = (normalized.details as { code?: string })?.code || "UPSTREAM_UNAVAILABLE";

      this.logger?.warn({
        event: "transcription.elevenlabs_failed",
        projectId,
        audioSourceId,
        provider: this.id,
        code,
        elapsedMs: Date.now() - startTime,
      });

      throw normalized;
    }
  }
}
