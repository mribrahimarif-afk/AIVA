import { DomainError } from "@/domain/errors";

export const CANONICAL_SAMPLE_RATE = 24000;
export const CANONICAL_NUM_CHANNELS = 1; // Mono
export const CANONICAL_BITS_PER_SAMPLE = 16;
export const CANONICAL_BYTES_PER_SAMPLE = (CANONICAL_BITS_PER_SAMPLE / 8) * CANONICAL_NUM_CHANNELS; // 2 bytes
export const CANONICAL_BYTE_RATE = CANONICAL_SAMPLE_RATE * CANONICAL_BYTES_PER_SAMPLE; // 48000 bytes/sec
export const CANONICAL_BLOCK_ALIGN = CANONICAL_NUM_CHANNELS * (CANONICAL_BITS_PER_SAMPLE / 8); // 2
export const WAV_HEADER_SIZE = 44;

/**
 * Strictly validates and decodes a base64 encoded audio string.
 *
 * Rules:
 * 1. Must be a non-empty string.
 * 2. Standard Base64 characters only ([A-Za-z0-9+/]) with valid padding (up to 2 '=').
 * 3. Length must be a positive multiple of 4.
 * 4. Must match canonical base64 re-encoding (Buffer.from(trimmed, "base64").toString("base64") === trimmed).
 * 5. Decoded buffer must be non-empty.
 * 6. Decoded buffer length must be a multiple of 2 for 16-bit PCM.
 *
 * Fails closed without silent sanitization.
 */
export function validateAndDecodeBase64Audio(rawBase64: unknown): Buffer {
  if (typeof rawBase64 !== "string") {
    throw new DomainError("REQUEST_FAILED", "Audio base64 data must be a string");
  }

  const trimmed = rawBase64.trim();
  if (trimmed.length === 0) {
    throw new DomainError("EMPTY_AUDIO", "Audio base64 data is empty");
  }

  if (trimmed.length % 4 !== 0) {
    throw new DomainError("REQUEST_FAILED", "Audio base64 data length is not a multiple of 4");
  }

  // Standard Base64 regex (rejects URL-safe, illegal characters, and invalid padding positions)
  const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/;
  if (!base64Regex.test(trimmed)) {
    throw new DomainError("REQUEST_FAILED", "Audio base64 data contains invalid characters or malformed padding");
  }

  const pcmBuffer = Buffer.from(trimmed, "base64");

  if (pcmBuffer.length === 0) {
    throw new DomainError("EMPTY_AUDIO", "Decoded audio buffer is empty");
  }

  // Canonical round-trip validation: prevents non-canonical representations
  if (pcmBuffer.toString("base64") !== trimmed) {
    throw new DomainError("REQUEST_FAILED", "Audio base64 data is not in canonical representation");
  }

  if (pcmBuffer.length % 2 !== 0) {
    throw new DomainError(
      "REQUEST_FAILED",
      `Decoded PCM buffer length (${pcmBuffer.length} bytes) is not a multiple of 2 for 16-bit audio`
    );
  }

  return pcmBuffer;
}

/**
 * Wraps raw signed 16-bit little-endian 24kHz mono PCM into a canonical 44-byte RIFF WAV container.
 */
export function pcm24kToWav(pcmBuffer: Buffer): Buffer {
  if (!pcmBuffer || !Buffer.isBuffer(pcmBuffer) || pcmBuffer.length === 0) {
    throw new DomainError("EMPTY_AUDIO", "Cannot create WAV from empty PCM buffer");
  }

  if (pcmBuffer.length % 2 !== 0) {
    throw new DomainError(
      "INVALID_AUDIO_FORMAT",
      `Invalid PCM buffer length (${pcmBuffer.length} bytes): must be a multiple of 2 for 16-bit samples`
    );
  }

  const dataSize = pcmBuffer.length;
  const totalSize = WAV_HEADER_SIZE + dataSize;
  const wavBuffer = Buffer.alloc(totalSize);

  // RIFF chunk descriptor
  wavBuffer.write("RIFF", 0, 4, "ascii");
  wavBuffer.writeUInt32LE(totalSize - 8, 4);
  wavBuffer.write("WAVE", 8, 4, "ascii");

  // fmt sub-chunk
  wavBuffer.write("fmt ", 12, 4, "ascii");
  wavBuffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for standard PCM)
  wavBuffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  wavBuffer.writeUInt16LE(CANONICAL_NUM_CHANNELS, 22);
  wavBuffer.writeUInt32LE(CANONICAL_SAMPLE_RATE, 24);
  wavBuffer.writeUInt32LE(CANONICAL_BYTE_RATE, 28);
  wavBuffer.writeUInt16LE(CANONICAL_BLOCK_ALIGN, 32);
  wavBuffer.writeUInt16LE(CANONICAL_BITS_PER_SAMPLE, 34);

  // data sub-chunk
  wavBuffer.write("data", 36, 4, "ascii");
  wavBuffer.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  pcmBuffer.copy(wavBuffer, WAV_HEADER_SIZE);

  return wavBuffer;
}

/**
 * Calculates duration in 100ns ticks from 24kHz 16-bit mono PCM byte count.
 * 1 second = 48,000 bytes = 10,000,000 ticks.
 * ticks = Math.round(bytes * (10,000,000 / 48,000)) = Math.round(bytes * 625 / 3)
 */
export function computePcm24kDurationTicks(pcmByteCount: number): number {
  if (!Number.isFinite(pcmByteCount) || pcmByteCount <= 0) {
    return 0;
  }
  return Math.round((pcmByteCount * 625) / 3);
}

/**
 * Calculates duration in milliseconds from 24kHz 16-bit mono PCM byte count.
 * 1 second = 48,000 bytes = 1,000 ms.
 * ms = Math.round((bytes / 48,000) * 1,000) = Math.round(bytes / 48)
 */
export function computePcm24kDurationMs(pcmByteCount: number): number {
  if (!Number.isFinite(pcmByteCount) || pcmByteCount <= 0) {
    return 0;
  }
  return Math.round(pcmByteCount / 48);
}
