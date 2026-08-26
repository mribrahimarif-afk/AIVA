import fs from "node:fs/promises";
import path from "node:path";
import { StorageError } from "@/domain/errors";
import { logger } from "@/infrastructure/logging/logger";
import {
  PROJECT_WORKSPACE_SUBDIRS,
  getProjectWorkspacePath,
  getProjectsRoot,
  getStorageRoot,
  getBrandsRoot,
  getAssetsRoot,
  getCacheRoot,
  getTempRoot,
} from "./paths";

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    throw new StorageError(`Failed to create directory: ${dirPath}`, {
      path: dirPath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Centralized filesystem operations for AIVA Studio. All storage access
 * (project workspaces, brand/asset/cache roots) is expected to go through
 * this service rather than calling `fs` directly elsewhere in the app.
 *
 * Every operation here is idempotent: re-running initialization or
 * re-creating an existing project's workspace is always safe and never
 * destroys existing files (mkdir with recursive:true is a no-op for
 * directories that already exist).
 */
export const storageService = {
  /**
   * Ensures the global storage skeleton exists: the root itself plus
   * brands/, assets/, cache/, and temp/. Safe to call on every app
   * startup (restart-safe, deterministic).
   */
  async initializeGlobalStorage(): Promise<void> {
    await ensureDir(getStorageRoot());
    await ensureDir(getProjectsRoot());
    await ensureDir(getBrandsRoot());
    await ensureDir(getAssetsRoot());
    await ensureDir(getCacheRoot());
    await ensureDir(getTempRoot());

    logger.info({ event: "storage.global_initialized", message: "Global storage skeleton ready" });
  },

  /**
   * Creates the full per-project workspace tree under
   * storage/projects/{projectId}/. Idempotent: calling this again for an
   * existing project (e.g. after a restart) does not touch existing files.
   */
  async initializeProjectWorkspace(projectId: string): Promise<string> {
    const workspacePath = getProjectWorkspacePath(projectId);
    await ensureDir(workspacePath);
    await Promise.all(
      PROJECT_WORKSPACE_SUBDIRS.map((subdir) => ensureDir(path.join(workspacePath, subdir)))
    );

    logger.info({
      event: "storage.project_workspace_initialized",
      projectId,
      message: "Project workspace ready",
    });

    return workspacePath;
  },

  /** Returns whether a project's workspace directory exists on disk. */
  async projectWorkspaceExists(projectId: string): Promise<boolean> {
    try {
      const stat = await fs.stat(getProjectWorkspacePath(projectId));
      return stat.isDirectory();
    } catch {
      return false;
    }
  },

  getStorageRoot,
  getProjectWorkspacePath,
};
