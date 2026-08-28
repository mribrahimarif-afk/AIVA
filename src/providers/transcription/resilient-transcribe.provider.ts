import { ProviderError, ValidationError } from "@/domain/errors";
import type {
  TranscriptionResult,
  TranscriptionProviderId,
} from "@/domain/transcription";
import type {
  TranscriptionInput,
  TranscriptionProvider,
} from "./transcription-provider.interface";
import type { GeminiTranscribeProvider } from "./gemini-transcribe.provider";
import type { AzureTranscribeProvider } from "./azure-transcribe.provider";
import type { ElevenLabsTranscribeProvider } from "./elevenlabs-transcribe.provider";
import type { Logger } from "@/infrastructure/logging/logger";

export interface ResilientTranscribeProviderOptions {
  geminiProvider: GeminiTranscribeProvider;
  azureProvider: AzureTranscribeProvider;
  elevenLabsProvider?: ElevenLabsTranscribeProvider;
  logger?: Logger;
}

/**
 * Strict allowlist of provider-level failure codes eligible for Azure fallback in AUTO mode.
 */
export const AUTO_FALLBACK_ELIGIBLE_CODES = new Set<string>([
  "UNCONFIGURED",
  "AUTH_FAILED",
  "FORBIDDEN",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_FAILURE",
  "UPSTREAM_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "MALFORMED_RESPONSE",
  "MISSING_TIMESTAMPS",
]);

export class ResilientTranscribeProvider implements TranscriptionProvider {
  readonly id: TranscriptionProviderId = "gemini-transcribe";
  readonly modelName = "resilient-transcription-router";

  private readonly geminiProvider: GeminiTranscribeProvider;
  private readonly azureProvider: AzureTranscribeProvider;
  private readonly elevenLabsProvider?: ElevenLabsTranscribeProvider;
  private readonly logger?: Logger;

  constructor(options: ResilientTranscribeProviderOptions) {
    this.geminiProvider = options.geminiProvider;
    this.azureProvider = options.azureProvider;
    this.elevenLabsProvider = options.elevenLabsProvider;
    this.logger = options.logger;
  }

  isConfigured(): boolean {
    return this.geminiProvider.isConfigured() || this.azureProvider.isConfigured();
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const { requestedMode = "AUTO", projectId, audioSourceId } = input;
    const mode = requestedMode.toUpperCase();

    if (mode === "GEMINI") {
      return this.geminiProvider.transcribe(input);
    }

    if (mode === "AZURE") {
      return this.azureProvider.transcribe(input);
    }

    if (mode === "ELEVENLABS") {
      if (!this.elevenLabsProvider) {
        throw new ProviderError(
          "elevenlabs-scribe",
          "ElevenLabs Scribe provider is not registered",
          { code: "NOT_CONFIGURED" }
        );
      }
      return this.elevenLabsProvider.transcribe(input);
    }

    if (mode !== "AUTO") {
      throw new ValidationError(`Unsupported transcription mode: ${requestedMode}`);
    }

    // AUTO Mode: Attempt 1 = Gemini, fallback = Azure (Max 2 attempts total)
    const autoStartTime = Date.now();

    // Check if Gemini is configured; if unconfigured, fall back to Azure directly
    if (!this.geminiProvider.isConfigured()) {
      this.logger?.info({
        event: "transcription.provider_fallback",
        projectId,
        audioSourceId,
        fromProvider: this.geminiProvider.id,
        toProvider: this.azureProvider.id,
        reason: "UNCONFIGURED",
        attemptsUsed: 0,
        elapsedMs: 0,
      });

      const result = await this.azureProvider.transcribe(input);
      return {
        ...result,
        requestedMode: "AUTO",
      };
    }

    try {
      const geminiResult = await this.geminiProvider.transcribe(input);
      return {
        ...geminiResult,
        requestedMode: "AUTO",
      };
    } catch (geminiError: unknown) {
      const elapsedGeminiMs = Date.now() - autoStartTime;

      // Extract error subcode from details.code or code strictly
      const code =
        typeof (geminiError as { details?: { code?: unknown } })?.details?.code === "string"
          ? String((geminiError as { details: { code: string } }).details.code)
          : typeof (geminiError as { code?: unknown })?.code === "string" &&
              (geminiError as { code: string }).code !== "PROVIDER_ERROR"
            ? String((geminiError as { code: string }).code)
            : "GENERIC_ERROR";

      // Fallback is ONLY allowed if error code is explicitly in the allowlist
      const isEligible = AUTO_FALLBACK_ELIGIBLE_CODES.has(code);

      if (!isEligible) {
        // Ineligible failures (e.g. local validation, INVALID_INPUT, INVALID_AUDIO, NO_SPEECH, DB, storage) must NOT trigger fallback
        throw geminiError;
      }

      this.logger?.warn({
        event: "transcription.provider_fallback",
        projectId,
        audioSourceId,
        fromProvider: this.geminiProvider.id,
        toProvider: this.azureProvider.id,
        fromModel: this.geminiProvider.modelName,
        reason: code,
        attemptsUsed: 1,
        elapsedMs: elapsedGeminiMs,
      });

      // Attempt 2: Azure fallback
      try {
        const azureResult = await this.azureProvider.transcribe(input);
        return {
          ...azureResult,
          requestedMode: "AUTO",
        };
      } catch (azureError: unknown) {
        // Re-throw Azure error as the terminal error
        this.logger?.error({
          event: "transcription.auto_exhausted",
          projectId,
          audioSourceId,
          attemptsUsed: 2,
          elapsedMs: Date.now() - autoStartTime,
        });
        throw azureError;
      }
    }
  }
}
