import { describe, it, expect } from "vitest";
import {
  pcm24kToWav,
  computePcm24kDurationTicks,
  computePcm24kDurationMs,
  WAV_HEADER_SIZE,
  CANONICAL_SAMPLE_RATE,
  CANONICAL_NUM_CHANNELS,
  CANONICAL_BITS_PER_SAMPLE,
  CANONICAL_BYTE_RATE,
  CANONICAL_BLOCK_ALIGN,
} from "@/domain/voice/pcm-to-wav";
import { DomainError } from "@/domain/errors";

describe("PCM to WAV Conversion & Duration Tests", () => {
  it("converts raw 24kHz 16-bit mono PCM into a canonical 44-byte RIFF WAV container", () => {
    // 1 second of 24kHz 16-bit mono PCM = 48,000 bytes
    const pcmData = Buffer.alloc(48000, 0x55);
    const wav = pcm24kToWav(pcmData);

    expect(wav.length).toBe(WAV_HEADER_SIZE + pcmData.length);

    // RIFF chunk descriptor
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");

    // fmt sub-chunk
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt32LE(16)).toBe(16); // Subchunk1Size
    expect(wav.readUInt16LE(20)).toBe(1); // AudioFormat (PCM)
    expect(wav.readUInt16LE(22)).toBe(CANONICAL_NUM_CHANNELS); // 1 channel (mono)
    expect(wav.readUInt32LE(24)).toBe(CANONICAL_SAMPLE_RATE); // 24000 Hz
    expect(wav.readUInt32LE(28)).toBe(CANONICAL_BYTE_RATE); // 48000 bytes/sec
    expect(wav.readUInt16LE(32)).toBe(CANONICAL_BLOCK_ALIGN); // 2 bytes
    expect(wav.readUInt16LE(34)).toBe(CANONICAL_BITS_PER_SAMPLE); // 16 bits

    // data sub-chunk
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcmData.length);

    // PCM payload preservation
    expect(wav.subarray(WAV_HEADER_SIZE)).toEqual(pcmData);
  });

  it("rejects empty or non-buffer PCM input with EMPTY_AUDIO", () => {
    expect(() => pcm24kToWav(Buffer.alloc(0))).toThrow(DomainError);
    expect(() => pcm24kToWav(null as never)).toThrow(DomainError);
    expect(() => pcm24kToWav(undefined as never)).toThrow(DomainError);
  });

  it("rejects odd-length PCM buffer with INVALID_AUDIO_FORMAT", () => {
    // 16-bit PCM must have an even number of bytes
    const oddPcm = Buffer.alloc(1001);
    expect(() => pcm24kToWav(oddPcm)).toThrow(DomainError);
    try {
      pcm24kToWav(oddPcm);
    } catch (err: unknown) {
      expect((err as DomainError).code).toBe("INVALID_AUDIO_FORMAT");
    }
  });

  it("calculates exact deterministic duration in ticks and milliseconds", () => {
    // 48,000 bytes = 1.0 second = 1,000 ms = 10,000,000 ticks
    expect(computePcm24kDurationTicks(48000)).toBe(10000000);
    expect(computePcm24kDurationMs(48000)).toBe(1000);

    // 24,000 bytes = 0.5 second = 500 ms = 5,000,000 ticks
    expect(computePcm24kDurationTicks(24000)).toBe(5000000);
    expect(computePcm24kDurationMs(24000)).toBe(500);

    // 120,000 bytes = 2.5 seconds = 2,500 ms = 25,000,000 ticks
    expect(computePcm24kDurationTicks(120000)).toBe(25000000);
    expect(computePcm24kDurationMs(120000)).toBe(2500);

    // Non-positive or invalid bytes return 0
    expect(computePcm24kDurationTicks(0)).toBe(0);
    expect(computePcm24kDurationTicks(-100)).toBe(0);
    expect(computePcm24kDurationMs(0)).toBe(0);
    expect(computePcm24kDurationMs(-100)).toBe(0);
  });
});
