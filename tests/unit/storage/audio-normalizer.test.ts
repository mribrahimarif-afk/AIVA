import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  parseWavDurationMs,
  isExactAzureWav,
  normalizeAudioForAzure,
} from "@/storage/audio-normalizer";
import { StorageError } from "@/domain/errors";

function createWavHeader(sampleRate: number, channels: number, bitsPerSample: number, dataBytes: number): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);

  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);

  return buffer;
}

describe("Audio Normalizer & Duration Probe (TASK-004B)", () => {
  it("correctly parses WAV duration from header byteRate and data chunk size", () => {
    const wav = createWavHeader(16000, 1, 16, 32000); // 1000ms
    const durationMs = parseWavDurationMs(wav);
    expect(durationMs).toBe(1000);
  });

  it("returns null for non-WAV buffer", () => {
    const randomBuffer = Buffer.from("NOT A WAV FILE DATA");
    expect(parseWavDurationMs(randomBuffer)).toBeNull();
  });

  it("isExactAzureWav correctly validates exact 16kHz 16-bit mono PCM WAV", () => {
    const exactWav = createWavHeader(16000, 1, 16, 32000);
    expect(isExactAzureWav(exactWav)).toBe(true);

    const stereoWav = createWavHeader(16000, 2, 16, 64000);
    expect(isExactAzureWav(stereoWav)).toBe(false);

    const highSampleRateWav = createWavHeader(44100, 1, 16, 88200);
    expect(isExactAzureWav(highSampleRateWav)).toBe(false);

    const bit24Wav = createWavHeader(16000, 1, 24, 48000);
    expect(isExactAzureWav(bit24Wav)).toBe(false);
  });

  it("normalizeAudioForAzure copies exact Azure WAV directly and cleans up temporary file", async () => {
    const exactWav = createWavHeader(16000, 1, 16, 32000);
    const result = await normalizeAudioForAzure("dummy.wav", exactWav);

    expect(fs.existsSync(result.tempWavPath)).toBe(true);
    await result.cleanup();
    expect(fs.existsSync(result.tempWavPath)).toBe(false);
  });
});
