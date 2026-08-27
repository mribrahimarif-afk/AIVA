import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { getEnv } from "@/infrastructure/config/env";
import { ProviderError } from "@/domain/errors";
import {
  DEFAULT_VOICE,
  SUPPORTED_VOICES,
  SupportedVoice,
  VOICE_OUTPUT_FORMAT,
  RawVoiceBoundary,
  VoiceSynthesisResult,
} from "@/domain/voice";
import { VoiceProvider, VoiceSynthesisOptions } from "./voice-provider.interface";

export interface AzureVoiceConfig {
  apiKey?: string;
  region?: string;
  defaultVoice?: SupportedVoice;
  timeoutMs?: number;
}

const ALLOWED_VOICE_DETAIL_CODES = new Set([
  "VOICE_UNCONFIGURED",
  "AUTH_FAILURE",
  "RATE_LIMITED",
  "TIMEOUT",
  "UPSTREAM_UNAVAILABLE",
  "NETWORK_FAILURE",
  "SYNTHESIS_FAILED",
  "EMPTY_AUDIO",
  "INVALID_AUDIO_DURATION",
  "AUDIO_TOO_LARGE",
  "WORD_BOUNDARY_ALIGNMENT_FAILED",
  "SOURCE_CHANGED",
  "DIRECTOR_PLAN_REQUIRED",
  "INVALID_VOICE",
  "REQUEST_FAILED",
] as const);

function sanitizeVoiceDetailCode(code: unknown): string {
  if (typeof code === "string" && ALLOWED_VOICE_DETAIL_CODES.has(code as never)) {
    return code;
  }
  return "REQUEST_FAILED";
}

export function validateSynthesisTimeoutMs(val: unknown): number {
  if (
    typeof val !== "number" ||
    !Number.isFinite(val) ||
    !Number.isSafeInteger(val) ||
    val < 5000 ||
    val > 300000
  ) {
    throw new ProviderError("azure-speech", "Invalid synthesis timeout configuration", {
      code: "REQUEST_FAILED",
    });
  }
  return val;
}

export class AzureVoiceProvider implements VoiceProvider {
  readonly id = "azure-speech";
  readonly defaultVoice: SupportedVoice;
  readonly defaultModel = "azure-neural";
  private readonly apiKey: string;
  private readonly region: string;
  private readonly timeoutMs: number;

  constructor(config?: AzureVoiceConfig) {
    const env = getEnv();
    this.apiKey = config?.apiKey ?? env.AZURE_SPEECH_KEY ?? "";
    this.region = config?.region ?? env.AZURE_SPEECH_REGION ?? "";

    const rawTimeout = config?.timeoutMs !== undefined ? config.timeoutMs : env.VOICE_SYNTHESIS_TIMEOUT_MS;
    this.timeoutMs = validateSynthesisTimeoutMs(rawTimeout);

    const configuredVoice = config?.defaultVoice ?? (env.AZURE_SPEECH_VOICE as SupportedVoice);
    this.defaultVoice = (SUPPORTED_VOICES as readonly string[]).includes(configuredVoice)
      ? configuredVoice
      : DEFAULT_VOICE;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0 && this.region && this.region.trim().length > 0);
  }

  async listVoices() {
    const { VOICE_PROFILES } = await import("@/domain/voice");
    return Object.values(VOICE_PROFILES);
  }

  async synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesisResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.id, "Azure Speech provider is not configured", {
        code: "VOICE_UNCONFIGURED",
      });
    }

    const { text, voiceName = this.defaultVoice } = options;

    if (!text || text.trim().length === 0) {
      throw new ProviderError(this.id, "Cannot synthesize empty script", {
        code: "EMPTY_AUDIO",
      });
    }

    if (!(SUPPORTED_VOICES as readonly string[]).includes(voiceName)) {
      throw new ProviderError(this.id, `Unsupported voice profile`, {
        code: "INVALID_VOICE",
      });
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(this.apiKey, this.region);
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm;
    speechConfig.speechSynthesisVoiceName = voiceName;

    // Use pull audio output stream or synthesize to memory
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null as unknown as sdk.AudioConfig);

    const boundaries: RawVoiceBoundary[] = [];

    synthesizer.wordBoundary = (_sender, event) => {
      // Capture word boundary events using exact SDK enum comparison only
      if (
        event.boundaryType === sdk.SpeechSynthesisBoundaryType.Word &&
        typeof event.text === "string" &&
        event.text.length > 0
      ) {
        boundaries.push({
          text: event.text,
          textOffset: event.textOffset,
          wordLength: event.wordLength,
          audioOffsetTicks: event.audioOffset,
          durationTicks: event.duration,
          boundaryType: "Word",
        });
      }
    };

    try {
      const result = await this.executeWithTimeout<sdk.SpeechSynthesisResult>(
        new Promise((resolve, reject) => {
          synthesizer.speakTextAsync(
            text,
            (res) => {
              if (res.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                resolve(res);
              } else if (res.reason === sdk.ResultReason.Canceled) {
                const cancellation = sdk.CancellationDetails.fromResult(res);
                const normalized = this.normalizeCancellation(cancellation);
                reject(normalized);
              } else {
                reject(
                  new ProviderError(this.id, "Azure Speech synthesis failed", {
                    code: "SYNTHESIS_FAILED",
                  })
                );
              }
            },
            (err) => {
              reject(this.normalizeError(err));
            }
          );
        }),
        synthesizer
      );

      const audioBuffer = Buffer.from(result.audioData);

      return {
        audioData: audioBuffer,
        audioDurationTicks: result.audioDuration,
        voiceName,
        outputFormat: VOICE_OUTPUT_FORMAT,
        boundaries,
      };
    } catch (err: unknown) {
      throw this.normalizeError(err);
    } finally {
      try {
        synthesizer.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  private async executeWithTimeout<T>(promise: Promise<T>, synthesizer: sdk.SpeechSynthesizer): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        try {
          synthesizer.close();
        } catch {
          // ignore
        }
        reject(
          new ProviderError(this.id, "Azure Speech synthesis timed out", {
            code: "TIMEOUT",
            timeoutMs: this.timeoutMs,
          })
        );
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private normalizeCancellation(details: sdk.CancellationDetails): ProviderError {
    const errorDetails = (details.errorDetails || "").toLowerCase();
    const reasonCode = details.ErrorCode;

    if (
      reasonCode === sdk.CancellationErrorCode.AuthenticationFailure ||
      reasonCode === sdk.CancellationErrorCode.Forbidden ||
      errorDetails.includes("401") ||
      errorDetails.includes("403") ||
      errorDetails.includes("unauthorized") ||
      errorDetails.includes("forbidden") ||
      errorDetails.includes("authentication")
    ) {
      return new ProviderError(this.id, "Azure Speech authentication failed", {
        code: "AUTH_FAILURE",
      });
    }

    if (
      reasonCode === sdk.CancellationErrorCode.TooManyRequests ||
      errorDetails.includes("429") ||
      errorDetails.includes("quota") ||
      errorDetails.includes("rate limit")
    ) {
      return new ProviderError(this.id, "Azure Speech rate limit exceeded", {
        code: "RATE_LIMITED",
      });
    }

    if (
      reasonCode === sdk.CancellationErrorCode.ConnectionFailure ||
      errorDetails.includes("network") ||
      errorDetails.includes("econnrefused") ||
      errorDetails.includes("etimedout")
    ) {
      return new ProviderError(this.id, "Azure Speech network connection failed", {
        code: "NETWORK_FAILURE",
      });
    }

    if (
      reasonCode === sdk.CancellationErrorCode.ServiceTimeout ||
      reasonCode === sdk.CancellationErrorCode.ServiceError ||
      errorDetails.includes("503") ||
      errorDetails.includes("unavailable")
    ) {
      return new ProviderError(this.id, "Azure Speech service unavailable", {
        code: "UPSTREAM_UNAVAILABLE",
      });
    }

    return new ProviderError(this.id, "Azure Speech synthesis canceled", {
      code: "SYNTHESIS_FAILED",
    });
  }

  private normalizeError(err: unknown): ProviderError {
    if (err instanceof ProviderError) {
      const safeCode = sanitizeVoiceDetailCode(err.details?.code);
      const safeDetails: Record<string, unknown> = { code: safeCode };
      if (
        typeof err.details?.timeoutMs === "number" &&
        Number.isFinite(err.details.timeoutMs) &&
        err.details.timeoutMs > 0
      ) {
        safeDetails.timeoutMs = Math.min(Math.floor(err.details.timeoutMs), 300000);
      }
      return new ProviderError(this.id, err.message, safeDetails);
    }

    const message = (err instanceof Error ? err.message : typeof err === "string" ? err : "").toLowerCase();

    if (message) {
      if (
        message.includes("401") ||
        message.includes("403") ||
        message.includes("unauthorized") ||
        message.includes("forbidden") ||
        message.includes("auth") ||
        message.includes("api key")
      ) {
        return new ProviderError(this.id, "Azure Speech authentication failed", {
          code: "AUTH_FAILURE",
        });
      }

      if (message.includes("429") || message.includes("quota") || message.includes("rate limit")) {
        return new ProviderError(this.id, "Azure Speech rate limit exceeded", {
          code: "RATE_LIMITED",
        });
      }

      if (message.includes("timeout") || message.includes("timed out") || message.includes("etimedout")) {
        return new ProviderError(this.id, "Azure Speech request timed out", {
          code: "TIMEOUT",
          timeoutMs: this.timeoutMs,
        });
      }

      if (
        message.includes("econnrefused") ||
        message.includes("network") ||
        message.includes("enotfound") ||
        message.includes("socket")
      ) {
        return new ProviderError(this.id, "Azure Speech network error", {
          code: "NETWORK_FAILURE",
        });
      }

      if (message.includes("503") || message.includes("unavailable")) {
        return new ProviderError(this.id, "Azure Speech service unavailable", {
          code: "UPSTREAM_UNAVAILABLE",
        });
      }
    }

    return new ProviderError(this.id, "Azure Speech synthesis failed", {
      code: "SYNTHESIS_FAILED",
    });
  }
}
