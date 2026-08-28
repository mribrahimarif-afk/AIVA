import path from "node:path";
import { ValidationError } from "@/domain/errors";

export interface SupportedAudioFormat {
  mimeType: string;
  extension: string;
  label: string;
}

export const SUPPORTED_AUDIO_FORMATS: Record<string, SupportedAudioFormat> = {
  "audio/wav": { mimeType: "audio/wav", extension: ".wav", label: "WAV Audio" },
  "audio/x-wav": { mimeType: "audio/wav", extension: ".wav", label: "WAV Audio" },
  "audio/wave": { mimeType: "audio/wav", extension: ".wav", label: "WAV Audio" },
  "audio/mpeg": { mimeType: "audio/mpeg", extension: ".mp3", label: "MP3 Audio" },
  "audio/mp3": { mimeType: "audio/mpeg", extension: ".mp3", label: "MP3 Audio" },
  "audio/mp4": { mimeType: "audio/mp4", extension: ".m4a", label: "M4A/MP4 Audio" },
  "audio/x-m4a": { mimeType: "audio/mp4", extension: ".m4a", label: "M4A Audio" },
  "audio/aac": { mimeType: "audio/aac", extension: ".aac", label: "AAC Audio" },
  "audio/ogg": { mimeType: "audio/ogg", extension: ".ogg", label: "OGG/Opus Audio" },
  "audio/opus": { mimeType: "audio/ogg", extension: ".opus", label: "Opus Audio" },
  "audio/webm": { mimeType: "audio/webm", extension: ".webm", label: "WebM Audio" },
};

/**
 * Sniffs the magic bytes from an audio buffer to detect its canonical MIME type and extension.
 */
export function detectAudioFormat(buffer: Buffer): { mimeType: string; extension: string } | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // 1. WAV (RIFF....WAVE)
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  ) {
    return { mimeType: "audio/wav", extension: ".wav" };
  }

  // 2. OGG (OggS)
  if (buffer.toString("ascii", 0, 4) === "OggS") {
    return { mimeType: "audio/ogg", extension: ".ogg" };
  }

  // 3. WebM / Matroska (0x1A, 0x45, 0xDF, 0xA3)
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { mimeType: "audio/webm", extension: ".webm" };
  }

  // 4. MP3 with ID3 header (ID3)
  if (buffer.toString("ascii", 0, 3) === "ID3") {
    return { mimeType: "audio/mpeg", extension: ".mp3" };
  }

  // 5. MP3 raw frame sync (0xFF 0xFB, 0xFF 0xF3, 0xFF 0xF2, 0xFF 0xFA, 0xFF 0xFE, etc.)
  if (buffer[0] === 0xff && buffer[1] !== undefined && (buffer[1] & 0xe0) === 0xe0) {
    return { mimeType: "audio/mpeg", extension: ".mp3" };
  }

  // 6. MP4 / M4A (....ftyp)
  if (buffer.length >= 8 && buffer.toString("ascii", 4, 8) === "ftyp") {
    return { mimeType: "audio/mp4", extension: ".m4a" };
  }

  return null;
}

/**
 * Sanitizes an uploaded filename, removing path traversal and forbidden characters.
 */
export function sanitizeAudioFilename(originalFilename: string | undefined | null): string {
  if (!originalFilename || typeof originalFilename !== "string") {
    return "uploaded-audio";
  }

  // Cross-platform basename extraction: split on both / and \
  const segments = originalFilename.split(/[/\\]/);
  const baseName = segments[segments.length - 1] || "uploaded-audio";
  // Replace illegal filename characters with dashes
  const sanitized = baseName.replace(/[/\\?%*:|"<>]/g, "-").trim();

  return sanitized || "uploaded-audio";
}

/**
 * Validates audio file payload by magic bytes, declared MIME type, and size limits.
 */
export function validateAudioUpload(
  buffer: Buffer,
  declaredMimeType: string,
  originalFilename: string | null | undefined,
  maxBytes: number
): { mimeType: string; extension: string; safeDisplayName: string } {
  if (!buffer || buffer.length === 0) {
    throw new ValidationError("Uploaded audio file is empty");
  }

  if (buffer.length > maxBytes) {
    throw new ValidationError(
      `Audio file size (${buffer.length} bytes) exceeds maximum limit of ${maxBytes} bytes`
    );
  }

  const detected = detectAudioFormat(buffer);
  const normalizedDeclared = declaredMimeType.toLowerCase().trim();

  let finalMime = detected?.mimeType;
  let finalExt = detected?.extension;

  if (!finalMime || !finalExt) {
    // If magic bytes were not recognized, check if declared MIME matches allowed list
    const supported = SUPPORTED_AUDIO_FORMATS[normalizedDeclared];
    if (!supported) {
      throw new ValidationError(
        `Unsupported audio format. Detected signature is unrecognized and declared MIME type "${declaredMimeType}" is not supported.`
      );
    }
    finalMime = supported.mimeType;
    finalExt = supported.extension;
  }

  const safeDisplayName = sanitizeAudioFilename(originalFilename);

  return {
    mimeType: finalMime,
    extension: finalExt,
    safeDisplayName,
  };
}
