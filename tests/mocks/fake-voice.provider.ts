import {
  DEFAULT_VOICE,
  RawVoiceBoundary,
  SupportedVoice,
  VOICE_OUTPUT_FORMAT,
  VoiceSynthesisResult,
} from "@/domain/voice";
import { VoiceProvider, VoiceSynthesisOptions } from "@/providers/voice";

/**
 * Creates a minimal valid 44-byte RIFF WAV header for 24kHz, 16-bit, Mono PCM audio.
 */
function createDeterministicWavBuffer(durationMs: number): Buffer {
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = (bitsPerSample / 8) * numChannels;
  const byteRate = sampleRate * bytesPerSample;
  const blockAlign = numChannels * (bitsPerSample / 8);

  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const dataSize = numSamples * bytesPerSample;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = Buffer.alloc(totalSize);

  // RIFF chunk descriptor
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(totalSize - 8, 4);
  buffer.write("WAVE", 8);

  // fmt sub-chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Fill data with gentle sine or deterministic pattern
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.floor(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

export interface FakeVoiceProviderOptions {
  id?: string;
  isConfigured?: boolean;
  defaultVoice?: string;
  defaultModel?: string;
  errorToThrow?: Error;
  delayMs?: number;
  customDurationMs?: number;
  customAudioBuffer?: Buffer;
  customBoundaries?: RawVoiceBoundary[];
  onSynthesize?: (options: VoiceSynthesisOptions) => void | Promise<void>;
}

export class FakeVoiceProvider implements VoiceProvider {
  readonly id: string;
  readonly defaultVoice: string;
  readonly defaultModel: string;

  private configured: boolean;
  private errorToThrow?: Error;
  private delayMs: number;
  private customDurationMs?: number;
  private customAudioBuffer?: Buffer;
  private customBoundaries?: RawVoiceBoundary[];
  private onSynthesize?: (options: VoiceSynthesisOptions) => void | Promise<void>;

  constructor(options: FakeVoiceProviderOptions = {}) {
    this.id = options.id ?? "fake-voice-provider";
    this.defaultVoice = options.defaultVoice !== undefined ? options.defaultVoice : DEFAULT_VOICE;
    this.defaultModel = options.defaultModel ?? "fake-voice-model";
    this.configured = options.isConfigured ?? true;
    this.errorToThrow = options.errorToThrow;
    this.delayMs = options.delayMs ?? 0;
    this.customDurationMs = options.customDurationMs;
    this.customAudioBuffer = options.customAudioBuffer;
    this.customBoundaries = options.customBoundaries;
    this.onSynthesize = options.onSynthesize;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesisResult> {
    if (this.onSynthesize) {
      await this.onSynthesize(options);
    }

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const { text, voiceName = this.defaultVoice } = options;

    // Build deterministic boundaries matching non-whitespace words in text
    let boundaries: RawVoiceBoundary[];
    if (this.customBoundaries) {
      boundaries = this.customBoundaries;
    } else {
      boundaries = [];
      // Regex for words preserving unicode letters & numbers
      const regex = /[\p{L}\p{N}]+/gu;
      let match: RegExpExecArray | null;
      let currentOffsetMs = 100;
      const wordDurationMs = 250;
      const pauseDurationMs = 50;

      while ((match = regex.exec(text)) !== null) {
        const wordText = match[0];
        const textOffset = match.index;
        const wordLength = wordText.length;

        boundaries.push({
          text: wordText,
          textOffset,
          wordLength,
          audioOffsetTicks: currentOffsetMs * 10000, // 10,000 ticks per ms
          durationTicks: wordDurationMs * 10000,
          boundaryType: "Word",
        });

        currentOffsetMs += wordDurationMs + pauseDurationMs;
      }
    }

    const lastBoundary = boundaries.length > 0 ? boundaries[boundaries.length - 1] : undefined;
    const durationMs =
      this.customDurationMs ??
      (lastBoundary
        ? Math.round(lastBoundary.audioOffsetTicks / 10000 + 500)
        : 1000);

    const audioData = this.customAudioBuffer ?? createDeterministicWavBuffer(durationMs);

    return {
      audioData,
      audioDurationTicks: durationMs * 10000, // 10,000 ticks per ms
      voiceName,
      outputFormat: VOICE_OUTPUT_FORMAT,
      boundaries,
    };
  }
}
