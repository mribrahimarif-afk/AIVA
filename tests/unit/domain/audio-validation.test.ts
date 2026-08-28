import { describe, it, expect } from "vitest";
import {
  detectAudioFormat,
  sanitizeAudioFilename,
  validateAudioUpload,
  SUPPORTED_AUDIO_FORMATS,
} from "@/domain/transcription";
import { ValidationError } from "@/domain/errors";

describe("Audio Validation & Format Sniffing (TASK-004B)", () => {
  it("detects canonical WAV files via RIFF....WAVE header", () => {
    const wavHeader = Buffer.alloc(44);
    wavHeader.write("RIFF", 0);
    wavHeader.writeUInt32LE(36, 4);
    wavHeader.write("WAVE", 8);

    const detected = detectAudioFormat(wavHeader);
    expect(detected).toEqual({ mimeType: "audio/wav", extension: ".wav" });
  });

  it("detects MP3 files with ID3 tag", () => {
    const id3Header = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]); // "ID3"
    const detected = detectAudioFormat(id3Header);
    expect(detected).toEqual({ mimeType: "audio/mpeg", extension: ".mp3" });
  });

  it("detects MP3 files with raw frame sync byte sequence", () => {
    const mp3Sync = Buffer.from([0xff, 0xfb, 0x90, 0x64]);
    const detected = detectAudioFormat(mp3Sync);
    expect(detected).toEqual({ mimeType: "audio/mpeg", extension: ".mp3" });
  });

  it("detects OGG/Opus files via OggS magic bytes", () => {
    const oggHeader = Buffer.from("OggS\x00\x02");
    const detected = detectAudioFormat(oggHeader);
    expect(detected).toEqual({ mimeType: "audio/ogg", extension: ".ogg" });
  });

  it("detects WebM/Matroska files via EBML header", () => {
    const webmHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]);
    const detected = detectAudioFormat(webmHeader);
    expect(detected).toEqual({ mimeType: "audio/webm", extension: ".webm" });
  });

  it("detects M4A/MP4 files via ftyp header", () => {
    const m4aHeader = Buffer.alloc(12);
    m4aHeader.writeUInt32BE(8, 0);
    m4aHeader.write("ftyp", 4);
    m4aHeader.write("M4A ", 8);

    const detected = detectAudioFormat(m4aHeader);
    expect(detected).toEqual({ mimeType: "audio/mp4", extension: ".m4a" });
  });

  it("sanitizes filenames and prevents path traversal", () => {
    expect(sanitizeAudioFilename("../../evil/secret.wav")).toBe("secret.wav");
    expect(sanitizeAudioFilename("..\\..\\windows\\system32.mp3")).toBe("system32.mp3");
    expect(sanitizeAudioFilename("my voiceover (1).mp3")).toBe("my voiceover (1).mp3");
    expect(sanitizeAudioFilename("")).toBe("uploaded-audio");
    expect(sanitizeAudioFilename(null)).toBe("uploaded-audio");
  });

  it("validates audio upload payload within size limits", () => {
    const wavBuffer = Buffer.alloc(100);
    wavBuffer.write("RIFF", 0);
    wavBuffer.write("WAVE", 8);

    const result = validateAudioUpload(wavBuffer, "audio/wav", "test.wav", 1000);
    expect(result.mimeType).toBe("audio/wav");
    expect(result.extension).toBe(".wav");
    expect(result.safeDisplayName).toBe("test.wav");
  });

  it("rejects empty buffer or payload exceeding max size", () => {
    expect(() => validateAudioUpload(Buffer.alloc(0), "audio/wav", "empty.wav", 1000)).toThrow(
      ValidationError
    );

    const largeBuffer = Buffer.alloc(500);
    largeBuffer.write("RIFF", 0);
    largeBuffer.write("WAVE", 8);
    expect(() => validateAudioUpload(largeBuffer, "audio/wav", "large.wav", 200)).toThrow(
      ValidationError
    );
  });
});
