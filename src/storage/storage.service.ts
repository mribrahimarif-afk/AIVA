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

/**
 * Safely checks if a path exists. Returns false ONLY when stat fails with
 * ENOENT (path genuinely does not exist). Any other filesystem error (e.g.
 * EACCES, EPERM, EIO, EBUSY) indicates an inaccessible or transiently failing
 * path that MAY exist, so it throws a StorageError rather than assuming the
 * path is missing. This prevents destructive cleanup from accidentally
 * deleting pre-existing workspaces when permission or I/O errors occur.
 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw new StorageError(`Failed to determine existence of path: ${target}`, {
      path: target,
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
    } catch (initError) {
      if (!workspaceAlreadyExisted) {
        try {
          await fs.rm(workspacePath, { recursive: true, force: true });
        } catch (cleanupError) {
          logger.error({
            event: "storage.partial_workspace_cleanup_failed",
            projectId,
            workspacePath,
            error: cleanupError,
            message:
              "Failed to remove partially-created project workspace after init failure; partial workspace is orphaned and requires manual cleanup",
          });
          throw new StorageError(
            "Failed to create project workspace, and cleanup of the partial workspace directory failed; partial workspace is orphaned",
            {
              projectId,
              workspacePath,
              partialWorkspaceOrphaned: true,
              initCause: initError instanceof Error ? initError.message : String(initError),
              cleanupCause: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            }
          );
        }
      }
      throw initError;
    }

    logger.info({
      event: "storage.project_workspace_initialized",
      projectId,
      message: "Project workspace ready",
    });

    return workspacePath;
  },

  /**
   * Returns whether a project's workspace directory exists on disk.
   * Returns false ONLY when the directory genuinely does not exist (ENOENT).
   * Throws a StorageError if access is denied or an I/O error occurs,
   * avoiding false negatives for existing but inaccessible paths.
   */
  async projectWorkspaceExists(projectId: string): Promise<boolean> {
    const workspacePath = getProjectWorkspacePath(projectId);
    try {
      const stat = await fs.stat(workspacePath);
      return stat.isDirectory();
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return false;
      }
      throw new StorageError(`Failed to determine workspace existence for project: ${projectId}`, {
        projectId,
        path: workspacePath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  },

  getStorageRoot,
  getProjectWorkspacePath,
};
