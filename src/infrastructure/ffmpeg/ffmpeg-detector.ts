import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getEnv } from "@/infrastructure/config/env";

const execFileAsync = promisify(execFile);

export interface FfmpegDetectionResult {
  available: boolean;
  path: string;
  version: string | null;
  source: "configured" | "path";
  error?: string;
}

async function probe(binary: string): Promise<{ version: string | null } | null> {
  try {
    const { stdout } = await execFileAsync(binary, ["-version"], { timeout: 5_000 });
    const firstLine = stdout.split(/\r?\n/, 1)[0] ?? "";
    const match = /ffmpeg version (\S+)/.exec(firstLine);
    return { version: match?.[1] ?? (firstLine.trim() || null) };
  } catch {
    return null;
  }
}

/**
 * Detects whether FFmpeg is available, without invoking any rendering.
 * Prefers an explicitly configured path (AIVA_FFMPEG_PATH); falls back to
 * "ffmpeg" resolved from the system PATH.
 */
export async function detectFfmpeg(): Promise<FfmpegDetectionResult> {
  const env = getEnv();
  const configuredPath = env.AIVA_FFMPEG_PATH.trim();

  if (configuredPath) {
    const result = await probe(configuredPath);
    if (result) {
      return { available: true, path: configuredPath, version: result.version, source: "configured" };
    }
    return {
      available: false,
      path: configuredPath,
      version: null,
      source: "configured",
      error: "Configured FFmpeg path did not respond to 'ffmpeg -version'",
    };
  }

  const result = await probe("ffmpeg");
  if (result) {
    return { available: true, path: "ffmpeg", version: result.version, source: "path" };
  }

  return {
    available: false,
    path: "ffmpeg",
    version: null,
    source: "path",
    error: "FFmpeg was not found on the system PATH",
  };
}
