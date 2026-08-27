import { getEnv } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/logging/logger";
import { ProviderError } from "@/domain/errors";
import {
  VoiceProfile,
  VoiceSynthesisResult,
  VOICE_OUTPUT_FORMAT,
  pcm24kToWav,
  computePcm24kDurationTicks,
  convertElevenLabsAlignmentToBoundaries,
  ElevenLabsAlignment,
} from "@/domain/voice";
import { VoiceProvider, VoiceSynthesisOptions } from "./voice-provider.interface";

export interface ElevenLabsVoiceConfig {
  apiKey?: string;
  modelId?: string;
  defaultVoiceId?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel - Multilingual
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v3";
export const ELEVENLABS_MAX_CHARS_V3 = 5000;

export function validateElevenLabsTimeoutMs(val: unknown): number {
  if (
    typeof val !== "number" ||
    !Number.isFinite(val) ||
    !Number.isSafeInteger(val) ||
    val < 5000 ||
    val > 300000
  ) {
    throw new ProviderError("elevenlabs", "Invalid synthesis timeout configuration", {
      code: "REQUEST_FAILED",
    });
  }
  return val;
}

export class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly id = "elevenlabs";
  readonly defaultVoice: string;
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(config?: ElevenLabsVoiceConfig) {
    const env = getEnv();
    this.apiKey = config?.apiKey ?? env.ELEVENLABS_API_KEY ?? "";
    this.defaultModel = config?.modelId ?? env.ELEVENLABS_MODEL_ID ?? DEFAULT_ELEVENLABS_MODEL_ID;
    this.defaultVoice =
      config?.defaultVoiceId ?? env.ELEVENLABS_DEFAULT_VOICE_ID ?? DEFAULT_ELEVENLABS_VOICE_ID;

    const rawTimeout = config?.timeoutMs !== undefined ? config.timeoutMs : env.ELEVENLABS_TIMEOUT_MS;
    this.timeoutMs = validateElevenLabsTimeoutMs(rawTimeout);
    this.fetchFn = config?.fetchFn ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async listVoices(): Promise<VoiceProfile[]> {
    if (!this.isConfigured()) {
      return this.getFallbackVoices();
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      const response = await this.fetchFn("https://api.elevenlabs.io/v1/voices", {
        method: "GET",
        headers: {
          "xi-api-key": this.apiKey,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (!response.ok) {
        logger.warn({
          event: "elevenlabs.list_voices_failed",
          status: response.status,
        });
        return this.getFallbackVoices();
      }

      const data = (await response.json()) as { voices?: Array<{ voice_id: string; name: string; labels?: Record<string, string> }> };
      if (!data || !Array.isArray(data.voices)) {
        return this.getFallbackVoices();
      }

      return data.voices.map((v) => {
        const genderLabel = (v.labels?.gender || "").toLowerCase();
        const gender = genderLabel.includes("female") ? "Female" : genderLabel.includes("male") ? "Male" : "Neutral";
        return {
          name: v.voice_id,
          displayName: v.name,
          language: v.labels?.language || "Multilingual",
          locale: "multilingual",
          gender,
          description: v.labels?.description || v.labels?.accent || v.name,
          provider: "ELEVENLABS",
          voiceId: v.voice_id,
        };
      });
    } catch (err: unknown) {
      logger.warn({
        event: "elevenlabs.list_voices_error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
      return this.getFallbackVoices();
    }
  }

  private getFallbackVoices(): VoiceProfile[] {
    return [
      {
        name: "21m00Tcm4TlvDq8ikWAM",
        displayName: "Rachel (Multilingual)",
        language: "Multilingual",
        locale: "multilingual",
        gender: "Female",
        description: "Calm and natural narration",
        isDefault: true,
        provider: "ELEVENLABS",
        voiceId: "21m00Tcm4TlvDq8ikWAM",
      },
      {
        name: "pNInz6obpgDQGcFmaJgB",
        displayName: "Adam (Multilingual)",
        language: "Multilingual",
        locale: "multilingual",
        gender: "Male",
        description: "Deep and clear narration",
        provider: "ELEVENLABS",
        voiceId: "pNInz6obpgDQGcFmaJgB",
      },
    ];
  }

  async synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesisResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(this.id, "ElevenLabs provider is not configured", {
        code: "VOICE_UNCONFIGURED",
      });
    }

    const { text, voiceName = this.defaultVoice, modelId = this.defaultModel } = options;

    if (!text || text.trim().length === 0) {
      throw new ProviderError(this.id, "Cannot synthesize empty script", {
        code: "EMPTY_AUDIO",
      });
    }

    // Preflight character length validation for eleven_v3
    if (modelId === "eleven_v3" && text.length > ELEVENLABS_MAX_CHARS_V3) {
      throw new ProviderError(
        this.id,
        `Script length (${text.length} chars) exceeds ElevenLabs ${modelId} limit of ${ELEVENLABS_MAX_CHARS_V3} characters`,
        {
          code: "REQUEST_FAILED",
          charCount: text.length,
          maxChars: ELEVENLABS_MAX_CHARS_V3,
        }
      );
    }

    const voiceId = voiceName && voiceName.trim().length > 0 ? voiceName.trim() : this.defaultVoice;
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=pcm_24000`;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
        }),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (timedOut || (err instanceof Error && err.name === "AbortError")) {
        throw new ProviderError(this.id, "ElevenLabs synthesis timed out", {
          code: "TIMEOUT",
          timeoutMs: this.timeoutMs,
        });
      }

      throw new ProviderError(this.id, "ElevenLabs network request failed", {
        code: "NETWORK_FAILURE",
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 401) {
        throw new ProviderError(this.id, "ElevenLabs authentication failed", {
          code: "AUTH_FAILURE",
        });
      }
      if (status === 403) {
        throw new ProviderError(this.id, "ElevenLabs access forbidden or quota restricted", {
          code: "AUTH_FAILURE",
        });
      }
      if (status === 429) {
        throw new ProviderError(this.id, "ElevenLabs rate limit or quota exceeded", {
          code: "RATE_LIMITED",
        });
      }
      if (status === 400 || status === 422) {
        throw new ProviderError(this.id, "ElevenLabs invalid request", {
          code: "REQUEST_FAILED",
        });
      }
      if (status >= 500) {
        throw new ProviderError(this.id, "ElevenLabs service unavailable", {
          code: "UPSTREAM_UNAVAILABLE",
        });
      }

      throw new ProviderError(this.id, `ElevenLabs synthesis failed with HTTP ${status}`, {
        code: "SYNTHESIS_FAILED",
      });
    }

    let rawData: unknown;
    try {
      rawData = await response.json();
    } catch {
      throw new ProviderError(this.id, "ElevenLabs returned invalid JSON response", {
        code: "REQUEST_FAILED",
      });
    }

    if (!rawData || typeof rawData !== "object") {
      throw new ProviderError(this.id, "ElevenLabs response is not a valid JSON object", {
        code: "REQUEST_FAILED",
      });
    }

    const data = rawData as { audio_base64?: unknown; alignment?: ElevenLabsAlignment };

    if (typeof data.audio_base64 !== "string" || data.audio_base64.trim().length === 0) {
      throw new ProviderError(this.id, "ElevenLabs returned empty or missing audio data", {
        code: "EMPTY_AUDIO",
      });
    }

    let pcmBuffer: Buffer;
    try {
      pcmBuffer = Buffer.from(data.audio_base64, "base64");
    } catch {
      throw new ProviderError(this.id, "ElevenLabs audio data is not valid base64", {
        code: "REQUEST_FAILED",
      });
    }

    if (pcmBuffer.length === 0) {
      throw new ProviderError(this.id, "ElevenLabs produced empty audio buffer", {
        code: "EMPTY_AUDIO",
      });
    }

    // 1. Wrap raw 24kHz 16-bit mono PCM into canonical WAV container
    const wavBuffer = pcm24kToWav(pcmBuffer);
    const audioDurationTicks = computePcm24kDurationTicks(pcmBuffer.length);

    // 2. Validate and convert ElevenLabs character timestamps to UTF-16 exact word boundaries
    const boundaries = convertElevenLabsAlignmentToBoundaries(text, data.alignment);

    return {
      audioData: wavBuffer,
      audioDurationTicks,
      voiceName: voiceId,
      model: modelId,
      outputFormat: VOICE_OUTPUT_FORMAT,
      boundaries,
    };
  }
}
