import type { PrismaClient } from "@prisma/client";
import { detectFfmpeg } from "@/infrastructure/ffmpeg/ffmpeg-detector";
import { storageService } from "@/storage/storage.service";
import { getStorageRoot } from "@/storage/paths";
import { logger } from "@/infrastructure/logging/logger";

export type ComponentState = "OK" | "DEGRADED" | "DOWN";
export type OverallState = "OK" | "DEGRADED" | "DOWN";

export interface HealthReport {
  status: OverallState;
  timestamp: string;
  database: { state: ComponentState; message?: string };
  storage: { state: ComponentState; root: string; message?: string };
  ffmpeg: { state: ComponentState; available: boolean; path: string; version: string | null; message?: string };
}

async function checkDatabase(db: PrismaClient): Promise<HealthReport["database"]> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { state: "OK" };
  } catch (error) {
    logger.error({ event: "health.database_check_failed", error });
    return { state: "DOWN", message: "Database is unreachable" };
  }
}

async function checkStorage(): Promise<HealthReport["storage"]> {
  const root = getStorageRoot();
  try {
    await storageService.initializeGlobalStorage();
    return { state: "OK", root };
  } catch (error) {
    logger.error({ event: "health.storage_check_failed", error });
    return { state: "DOWN", root, message: "Storage root is not writable" };
  }
}

async function checkFfmpeg(): Promise<HealthReport["ffmpeg"]> {
  const result = await detectFfmpeg();
  return {
    state: result.available ? "OK" : "DEGRADED",
    available: result.available,
    path: result.path,
    version: result.version,
    ...(result.error ? { message: result.error } : {}),
  };
}

/**
 * Aggregates database, storage, and FFmpeg checks into a single report.
 * A missing FFmpeg installation degrades the overall status rather than
 * failing the health check outright — rendering is not implemented yet,
 * so its absence should never take the app down.
 */
export function createHealthService(db: PrismaClient) {
  return {
    async check(): Promise<HealthReport> {
      const [database, storage, ffmpeg] = await Promise.all([
        checkDatabase(db),
        checkStorage(),
        checkFfmpeg(),
      ]);

      const states = [database.state, storage.state, ffmpeg.state];
      let status: OverallState = "OK";
      if (states.includes("DOWN")) {
        status = "DOWN";
      } else if (states.includes("DEGRADED")) {
        status = "DEGRADED";
      }

      return {
        status,
        timestamp: new Date().toISOString(),
        database,
        storage,
        ffmpeg,
      };
    },
  };
}
