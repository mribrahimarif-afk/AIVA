import fs from "node:fs/promises";
import path from "node:path";
import crypto, { randomUUID } from "node:crypto";
import { StorageError } from "@/domain/errors";
import { logger } from "@/infrastructure/logging/logger";
import {
  PROJECT_WORKSPACE_SUBDIRS,
  getProjectWorkspacePath,
  getProjectsRoot,
  getStorageRoot,
  getBrandsRoot,
  getAssetsRoot,
  getBlobsRoot,
  getCacheRoot,
  getTempRoot,
  getCanonicalBlobPath,
  toStorageRelativePath,
  resolveStoragePath,
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

export const storageService = {
  /**
   * Ensures the global storage skeleton exists: root plus brands/, assets/,
   * assets/blobs/, cache/, and temp/. Safe to call on every app startup.
   */
  async initializeGlobalStorage(): Promise<void> {
    await ensureDir(getStorageRoot());
    await ensureDir(getProjectsRoot());
    await ensureDir(getBrandsRoot());
    await ensureDir(getAssetsRoot());
    await ensureDir(getBlobsRoot());
    await ensureDir(getCacheRoot());
    await ensureDir(getTempRoot());

    logger.info({ event: "storage.global_initialized", message: "Global storage skeleton ready" });
  },

  /**
   * Writes and deletes a small probe file under the global temp root to
   * confirm the storage root is actually writable.
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
   * Creates the full per-project workspace tree under storage/projects/{projectId}/.
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

  /**
   * Stages an uploaded binary buffer safely into storage/temp/.
   * Sanitizes originalFilename, calculates SHA-256 checksum, and returns file staging info.
   */
  async stageFile(fileBuffer: Buffer, originalFilename: string): Promise<{
    tempPath: string;
    sizeBytes: number;
    checksum: string;
    extension: string;
    sanitizedFilename: string;
  }> {
    await ensureDir(getTempRoot());
    const sanitizedFilename = path.basename(originalFilename).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const extension = path.extname(sanitizedFilename) || ".bin";
    const tempPath = path.join(getTempRoot(), `upload-${randomUUID()}-${sanitizedFilename}`);

    try {
      await fs.writeFile(tempPath, fileBuffer);
    } catch (error) {
      throw new StorageError(`Failed to stage temporary upload file: ${sanitizedFilename}`, {
        tempPath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    return {
      tempPath,
      sizeBytes: fileBuffer.length,
      checksum,
      extension,
      sanitizedFilename,
    };
  },

  /**
   * Finalizes a staged upload file to its permanent canonical location:
   * storage/assets/blobs/{checksum-prefix}/{checksum}.{ext}
   * Returns relative storage path.
   */
  async finalizeBlob(tempPath: string, checksum: string, extension: string): Promise<{
    canonicalAbsolutePath: string;
    storageRelativePath: string;
    isDuplicate: boolean;
  }> {
    const canonicalAbs = getCanonicalBlobPath(checksum, extension);
    const targetDir = path.dirname(canonicalAbs);
    await ensureDir(targetDir);

    const alreadyExists = await pathExists(canonicalAbs);

    if (alreadyExists) {
      await this.removeTempFile(tempPath);
      return {
        canonicalAbsolutePath: canonicalAbs,
        storageRelativePath: toStorageRelativePath(canonicalAbs),
        isDuplicate: true,
      };
    }

    try {
      await fs.rename(tempPath, canonicalAbs);
    } catch {
      // Fallback for cross-device filesystem moves
      try {
        await fs.copyFile(tempPath, canonicalAbs);
        await this.removeTempFile(tempPath);
      } catch (copyError) {
        await this.removeTempFile(tempPath);
        throw new StorageError(`Failed to finalize canonical blob file at ${canonicalAbs}`, {
          tempPath,
          canonicalAbsolutePath: canonicalAbs,
          cause: copyError instanceof Error ? copyError.message : String(copyError),
        });
      }
    }

    return {
      canonicalAbsolutePath: canonicalAbs,
      storageRelativePath: toStorageRelativePath(canonicalAbs),
      isDuplicate: false,
    };
  },

  /**
   * Safely deletes a staged temporary file.
   */
  async removeTempFile(tempPath: string): Promise<void> {
    try {
      await fs.rm(tempPath, { force: true });
    } catch (error) {
      logger.error({
        event: "storage.temp_file_cleanup_failed",
        tempPath,
        error,
        message: "Failed to remove temporary file; file may be orphaned",
      });
      throw new StorageError(`Failed to remove temporary file: ${tempPath}`, {
        tempPath,
        partialUploadOrphaned: true,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  },

  pathExists,
  getStorageRoot,
  getProjectWorkspacePath,
  toStorageRelativePath,
  resolveStoragePath,
};
