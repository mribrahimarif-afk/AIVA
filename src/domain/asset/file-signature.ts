export type DetectedFileType =
  | "png"
  | "jpg"
  | "webp"
  | "mp4"
  | "mov"
  | "webm"
  | "mp3"
  | "wav"
  | "m4a"
  | "ttf"
  | "otf"
  | "woff"
  | "woff2";

export interface FileSignatureResult {
  detectedExt: DetectedFileType | null;
  detectedMime: string | null;
  isValidSignature: boolean;
  reason?: string;
}

export interface FormatSpec {
  canonicalExt: DetectedFileType;
  allowedExtensions: string[];
  allowedMimes: string[];
}

export const FORMAT_SPECS: Record<DetectedFileType, FormatSpec> = {
  png: {
    canonicalExt: "png",
    allowedExtensions: [".png"],
    allowedMimes: ["image/png"],
  },
  jpg: {
    canonicalExt: "jpg",
    allowedExtensions: [".jpg", ".jpeg"],
    allowedMimes: ["image/jpeg", "image/jpg", "image/pjpeg"],
  },
  webp: {
    canonicalExt: "webp",
    allowedExtensions: [".webp"],
    allowedMimes: ["image/webp"],
  },
  mp4: {
    canonicalExt: "mp4",
    allowedExtensions: [".mp4", ".m4v"],
    allowedMimes: ["video/mp4"],
  },
  mov: {
    canonicalExt: "mov",
    allowedExtensions: [".mov", ".qt"],
    allowedMimes: ["video/quicktime"],
  },
  webm: {
    canonicalExt: "webm",
    allowedExtensions: [".webm"],
    allowedMimes: ["video/webm"],
  },
  mp3: {
    canonicalExt: "mp3",
    allowedExtensions: [".mp3"],
    allowedMimes: ["audio/mpeg", "audio/mp3"],
  },
  wav: {
    canonicalExt: "wav",
    allowedExtensions: [".wav"],
    allowedMimes: ["audio/wav", "audio/x-wav", "audio/wave"],
  },
  m4a: {
    canonicalExt: "m4a",
    allowedExtensions: [".m4a"],
    allowedMimes: ["audio/mp4", "audio/x-m4a", "audio/m4a"],
  },
  ttf: {
    canonicalExt: "ttf",
    allowedExtensions: [".ttf"],
    allowedMimes: ["font/ttf", "font/sfnt", "application/x-font-ttf"],
  },
  otf: {
    canonicalExt: "otf",
    allowedExtensions: [".otf"],
    allowedMimes: ["font/otf", "font/sfnt", "application/x-font-opentype"],
  },
  woff: {
    canonicalExt: "woff",
    allowedExtensions: [".woff"],
    allowedMimes: ["font/woff", "application/font-woff"],
  },
  woff2: {
    canonicalExt: "woff2",
    allowedExtensions: [".woff2"],
    allowedMimes: ["font/woff2", "application/font-woff2"],
  },
};

/**
 * Normalizes a declared MIME type string safely (strips parameters like ; charset=utf-8, trims, lowercases).
 */
export function normalizeMimeType(mime: string): string {
  if (!mime) return "application/octet-stream";
  const clean = mime.split(";")[0]?.trim().toLowerCase();
  return clean || "application/octet-stream";
}

/**
 * Inspects leading file bytes (up to 8192 bytes) to detect canonical media format.
 * SVG support is intentionally deferred until a full-document sanitizer exists.
 */
export function detectFileSignature(buffer: Buffer): FileSignatureResult {
  if (!buffer || buffer.length === 0) {
    return { detectedExt: null, detectedMime: null, isValidSignature: false, reason: "Empty file payload" };
  }

  // Check for Executable / Binary Header signatures
  // 1. Windows PE Executable (MZ): 4D 5A
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { detectedExt: null, detectedMime: null, isValidSignature: false, reason: "Executable PE binary signature detected" };
  }

  // 2. Linux ELF Executable: 7F 45 4C 46
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
    return { detectedExt: null, detectedMime: null, isValidSignature: false, reason: "Executable ELF binary signature detected" };
  }

  // 3. Mach-O Executable / Java Class (CAFEBABE or FEEDFACE)
  if (buffer.length >= 4) {
    const magicHex = buffer.toString("hex", 0, 4);
    if (magicHex === "cafebabe" || magicHex === "feedface" || magicHex === "feedfacf") {
      return { detectedExt: null, detectedMime: null, isValidSignature: false, reason: "Executable Mach-O/Java binary signature detected" };
    }
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { detectedExt: "png", detectedMime: "image/png", isValidSignature: true };
  }

  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { detectedExt: "jpg", detectedMime: "image/jpeg", isValidSignature: true };
  }

  // WEBP: "RIFF" at [0..3], "WEBP" at [8..11]
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { detectedExt: "webp", detectedMime: "image/webp", isValidSignature: true };
  }

  // WEBM: 1A 45 DF A3 (EBML header)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { detectedExt: "webm", detectedMime: "video/webm", isValidSignature: true };
  }

  // MP4 / MOV / M4A: "ftyp" at offset 4
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12).trim().toLowerCase();
    if (brand.startsWith("m4a") || brand.startsWith("mp42") || brand.startsWith("isom")) {
      if (brand.startsWith("m4a")) {
        return { detectedExt: "m4a", detectedMime: "audio/mp4", isValidSignature: true };
      }
    }
    if (brand.startsWith("qt")) {
      return { detectedExt: "mov", detectedMime: "video/quicktime", isValidSignature: true };
    }
    return { detectedExt: "mp4", detectedMime: "video/mp4", isValidSignature: true };
  }

  // WAV: "RIFF" at [0..3], "WAVE" at [8..11]
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  ) {
    return { detectedExt: "wav", detectedMime: "audio/wav", isValidSignature: true };
  }

  // MP3: "ID3" at [0..2] or Frame Sync (0xFF 0xFB / 0xF3 / 0xF2 / 0xE3)
  if (buffer.length >= 3 && buffer.toString("ascii", 0, 3) === "ID3") {
    return { detectedExt: "mp3", detectedMime: "audio/mpeg", isValidSignature: true };
  }
  if (
    buffer.length >= 2 &&
    buffer[0] === 0xff &&
    (buffer[1] === 0xfb || buffer[1] === 0xf3 || buffer[1] === 0xf2 || buffer[1] === 0xe3)
  ) {
    return { detectedExt: "mp3", detectedMime: "audio/mpeg", isValidSignature: true };
  }

  // Fonts: TTF, OTF, WOFF, WOFF2
  if (buffer.length >= 4) {
    const fontMagic = buffer.toString("hex", 0, 4);
    const fontAscii = buffer.toString("ascii", 0, 4);

    if (fontMagic === "00010000" || fontAscii === "true") {
      return { detectedExt: "ttf", detectedMime: "font/ttf", isValidSignature: true };
    }
    if (fontAscii === "OTTO") {
      return { detectedExt: "otf", detectedMime: "font/otf", isValidSignature: true };
    }
    if (fontAscii === "wOFF") {
      return { detectedExt: "woff", detectedMime: "font/woff", isValidSignature: true };
    }
    if (fontAscii === "wOF2") {
      return { detectedExt: "woff2", detectedMime: "font/woff2", isValidSignature: true };
    }
  }

  return {
    detectedExt: null,
    detectedMime: null,
    isValidSignature: false,
    reason: "Unrecognized or unsupported file magic bytes signature",
  };
}
