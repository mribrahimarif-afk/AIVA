import { describe, it, expect } from "vitest";
import { parseWavDurationMs } from "@/storage/audio-normalizer";

describe("Audio Normalizer & Duration Probe (TASK-004B)", () => {
  it("correctly parses WAV duration from header byteRate and data chunk size", () => {
    // Construct a minimal 44-byte WAV header for 16kHz 16-bit mono PCM (byteRate = 32000 bytes/sec)
    const wav = Buffer.alloc(44 + 32000); // 1 second of audio data
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + 32000, 4);
    wav.write("WAVE", 8);

    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16); // fmt chunk size
    wav.writeUInt16LE(1, 20); // PCM format
    wav.writeUInt16LE(1, 22); // 1 channel
    wav.writeUInt32LE(16000, 24); // 16000 sample rate
    wav.writeUInt32LE(32000, 28); // 32000 byte rate
    wav.writeUInt16LE(2, 32); // block align
    wav.writeUInt16LE(16, 34); // bits per sample

    wav.write("data", 36);
    wav.writeUInt32LE(32000, 40); // 32000 data bytes = 1000ms

    const durationMs = parseWavDurationMs(wav);
    expect(durationMs).toBe(1000);
  });

  it("returns null for non-WAV buffer", () => {
    const randomBuffer = Buffer.from("NOT A WAV FILE DATA");
    expect(parseWavDurationMs(randomBuffer)).toBeNull();
  });
});
