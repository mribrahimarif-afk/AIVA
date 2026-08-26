import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
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

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
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
   * Writes and deletes a small probe file under the global temp root to
   * confirm the storage root is actually writable, not merely present.
   * `initializeGlobalStorage`/`initializeProjectWorkspace` only prove a
   * directory *exists* — `mkdir(recursive: true)` on an already-existing
   * directory tree succeeds even if that tree is read-only, which would
   * otherwise let a read-only storage root report healthy right up until
   * the first real write.
   */
  async verifyWritable(): Promise<void> {
    await ensureDir(getTempRoot());
    const probePath = path.join(getTempRoot(), `.write-probe-${randomUUID()}`);
    try {
      await fs.writeFile(probePath, "ok");
      await fs.rm(probePath, { force: true });
    } catch (error) {
      throw new StorageError("Storage root is not writable", {
        path: probePath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  },

  /**
   * Creates the full per-project workspace tree under
   * storage/projects/{projectId}/. Idempotent: calling this again for an
   * existing project (e.g. after a restart) does not touch existing files.
   *
   * If any subdirectory fails to create, the whole call fails — but only
   * if this call is what created the workspace root does it remove the
   * partially-built tree afterward. A workspace that already existed
   * before this call (e.g. a previously-succeeded init, or a directory a
   * user manually restored) is never deleted just because a later
   * subdirectory couldn't be created, which would otherwise violate
   * idempotency.
   */
  async initializeProjectWorkspace(projectId: string): Promise<string> {
    const workspacePath = getProjectWorkspacePath(projectId);
    const workspaceAlreadyExisted = await pathExists(workspacePath);

    try {
      await ensureDir(workspacePath);
      for (const subdir of PROJECT_WORKSPACE_SUBDIRS) {
        await ensureDir(path.join(workspacePath, subdir));
      }
    } catch (error) {
      if (!workspaceAlreadyExisted) {
        await fs.rm(workspacePath, { recursive: true, force: true }).catch((cleanupError: unknown) => {
          logger.error({
            event: "storage.partial_workspace_cleanup_failed",
            projectId,
            error: cleanupError,
            message: "Failed to remove partially-created project workspace after init failure",
          });
        });
      }
      throw error;
    }

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
