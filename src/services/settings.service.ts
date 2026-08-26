import { getEnv } from "@/infrastructure/config/env";
import { getStorageRoot } from "@/storage/paths";
import { detectFfmpeg } from "@/infrastructure/ffmpeg/ffmpeg-detector";
import { getProviderStatuses, type ProviderStatusEntry } from "@/providers/provider-status";

export interface SettingsSnapshot {
  storageRoot: string;
  ffmpeg: {
    configuredPath: string | null;
    detected: boolean;
    resolvedPath: string;
    version: string | null;
  };
  defaultAspectRatio: string;
  logLevel: string;
  providers: ProviderStatusEntry[];
}

/**
 * Read-only snapshot of current configuration for the Settings screen.
 * TASK-001 does not support editing these values through the UI — they
 * are sourced from environment configuration; this service only reports
 * their current, resolved state (including live FFmpeg detection).
 */
export async function getSettingsSnapshot(): Promise<SettingsSnapshot> {
  const env = getEnv();
  const ffmpeg = await detectFfmpeg();

  return {
    storageRoot: getStorageRoot(),
    ffmpeg: {
      configuredPath: env.AIVA_FFMPEG_PATH.trim() || null,
      detected: ffmpeg.available,
      resolvedPath: ffmpeg.path,
      version: ffmpeg.version,
    },
    defaultAspectRatio: env.AIVA_DEFAULT_ASPECT_RATIO,
    logLevel: env.AIVA_LOG_LEVEL,
    providers: getProviderStatuses(),
  };
}
