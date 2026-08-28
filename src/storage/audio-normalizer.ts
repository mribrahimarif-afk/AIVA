import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getTempRoot } from "./paths";
import { getEnv } from "@/infrastructure/config/env";
import { StorageError } from "@/domain/errors";

const execFileAsync = promisify(execFile);

/**
 * Parses WAV header directly from buffer without external tools.
 */
export function parseWavDurationMs(buffer: Buffer): number | null {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt " && chunkSize >= 16) {
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }

    offset += 8 + chunkSize;
  }

  if (byteRate > 0 && dataSize > 0) {
    return Math.round((dataSize / byteRate) * 1000);
  }

  return null;
}

/**
 * Finds the ffmpeg binary path from config or system PATH.
 */
function getFfmpegPath(): string {
  const env = getEnv();
  return env.AIVA_FFMPEG_PATH && env.AIVA_FFMPEG_PATH.trim().length > 0
    ? env.AIVA_FFMPEG_PATH.trim()
    : "ffmpeg";
}

/**
 * Probes the duration of an audio buffer or file in milliseconds.
 */
export async function probeAudioDurationMs(
  buffer: Buffer,
  absolutePath?: string
): Promise<number | null> {
  // 1. Try direct WAV parsing if buffer is a WAV
  const wavDuration = parseWavDurationMs(buffer);
  if (wavDuration !== null) {
    return wavDuration;
  }

  // 2. If an absolute file path is given or we can write a quick temp probe, try ffprobe / ffmpeg
  const targetPath = absolutePath;

  if (targetPath) {
    try {
      const { stdout } = await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          targetPath,
        ],
        { timeout: 5000 }
      );

      const seconds = parseFloat(stdout.trim());
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.round(seconds * 1000);
      }
    } catch {
      // ffprobe not on PATH or probe failed; fallback gracefully
    }
  }

  return null;
}

export interface AzureNormalizedAudioResult {
  tempWavPath: string;
  cleanup: () => Promise<void>;
}

/**
 * Isolated audio normalizer for Azure Speech SDK.
 * Converts compressed audio (MP3, M4A, OGG, WEBM) or arbitrary WAV to a temporary 16kHz 16-bit mono PCM WAV.
 * Guarantees that the temporary file is created in a safe location and provides a cleanup callback.
 */
export async function normalizeAudioForAzure(
  sourceFilePath: string,
  sourceBuffer?: Buffer
): Promise<AzureNormalizedAudioResult> {
  const tempRoot = getTempRoot();
  await fs.promises.mkdir(tempRoot, { recursive: true });

  const tempWavName = `azure-norm-${crypto.randomUUID()}.wav`;
  const tempWavPath = path.join(tempRoot, tempWavName);

  const cleanup = async () => {
    try {
      await fs.promises.unlink(tempWavPath);
    } catch {
      // Ignore ENOENT on cleanup
    }
  };

  // If source is already a 16kHz mono WAV, we can copy or convert directly
  const ffmpegBin = getFfmpegPath();

  try {
    // Convert to 16kHz, 1-channel, 16-bit PCM WAV
    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-i",
        sourceFilePath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
        tempWavPath,
      ],
      { timeout: 30000 }
    );

    // Verify converted file exists and has content
    const stat = await fs.promises.stat(tempWavPath);
    if (stat.size < 44) {
      throw new StorageError("Audio normalization produced invalid or empty WAV output");
    }

    return {
      tempWavPath,
      cleanup,
    };
  } catch (err: unknown) {
    // If ffmpeg failed or is unavailable, check if the source file is already a readable WAV
    if (sourceBuffer) {
      const wavDuration = parseWavDurationMs(sourceBuffer);
      if (wavDuration !== null) {
        // Source is a valid WAV, copy it directly to tempWavPath
        await fs.promises.writeFile(tempWavPath, sourceBuffer);
        return {
          tempWavPath,
          cleanup,
        };
      }
    }

    await cleanup();
    throw new StorageError(
      "Failed to normalize audio for Azure Speech recognition. Please ensure ffmpeg is installed or provide a standard 16kHz WAV file.",
      { cause: err }
    );
  }
}
