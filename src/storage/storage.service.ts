import fs from "node:fs/promises";
import createWriteStream from "node:fs";
import path from "node:path";
import crypto, { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { StorageError, ValidationError } from "@/domain/errors";
import { getEnv } from "@/infrastructure/config/env";
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

export interface StagedUploadResult {
  tempPath: string;
  sizeBytes: number;
  checksum: string;
  extension: string;
  sanitizedFilename: string;
  leadingBuffer: Buffer;
}

export const storageService = {
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
              "Failed to remove partially-created project workspace after init failure; partial workspace is orphaned",
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
   * Stages a file buffer into storage/temp/ with incremental SHA-256 calculation.
   */
  async stageFile(fileBuffer: Buffer, originalFilename: string): Promise<StagedUploadResult> {
    const env = getEnv();
    if (fileBuffer.length > env.AIVA_MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `Upload size (${fileBuffer.length} bytes) exceeds maximum allowed limit (${env.AIVA_MAX_UPLOAD_BYTES} bytes)`
      );
    }

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
    const leadingBuffer = fileBuffer.subarray(0, Math.min(fileBuffer.length, 8192));

    return {
      tempPath,
      sizeBytes: fileBuffer.length,
      checksum,
      extension,
      sanitizedFilename,
      leadingBuffer,
    };
  },

  /**
   * Streams input readable stream into storage/temp/ with incremental SHA-256 and max upload bytes enforcement.
   */
  async stageStream(
    stream: ReadableStream<Uint8Array> | Readable,
    originalFilename: string,
    contentLength?: number
  ): Promise<StagedUploadResult> {
    const env = getEnv();
    if (contentLength && contentLength > env.AIVA_MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `Upload size (${contentLength} bytes) exceeds maximum allowed limit (${env.AIVA_MAX_UPLOAD_BYTES} bytes)`
      );
    }

    await ensureDir(getTempRoot());
    const sanitizedFilename = path.basename(originalFilename).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const extension = path.extname(sanitizedFilename) || ".bin";
    const tempPath = path.join(getTempRoot(), `upload-${randomUUID()}-${sanitizedFilename}`);

    const hash = crypto.createHash("sha256");
    const writeStream = createWriteStream.createWriteStream(tempPath);
    const leadingChunks: Buffer[] = [];
    let leadingBytesCount = 0;
    let totalBytes = 0;

    try {
      // Convert ReadableStream if Web stream passed
      let nodeStream: Readable;
      if ("getReader" in stream) {
        nodeStream = Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0]);
      } else {
        nodeStream = stream as Readable;
      }

      for await (const chunk of nodeStream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;

        if (totalBytes > env.AIVA_MAX_UPLOAD_BYTES) {
          writeStream.destroy();
          await fs.rm(tempPath, { force: true });
          throw new ValidationError(
            `Upload exceeded maximum allowed size limit of ${env.AIVA_MAX_UPLOAD_BYTES} bytes`
          );
        }

        hash.update(buf);
        writeStream.write(buf);

        if (leadingBytesCount < 8192) {
          leadingChunks.push(buf);
          leadingBytesCount += buf.length;
        }
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      if (error instanceof ValidationError) throw error;
      throw new StorageError(`Failed to stream upload payload to temporary storage: ${sanitizedFilename}`, {
        tempPath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }

    const checksum = hash.digest("hex");
    const leadingBuffer = Buffer.concat(leadingChunks).subarray(0, 8192);

    return {
      tempPath,
      sizeBytes: totalBytes,
      checksum,
      extension,
      sanitizedFilename,
      leadingBuffer,
    };
  },

  /**
   * Finalizes a staged upload file to its permanent canonical location:
   * storage/assets/blobs/{checksum-prefix}/{checksum}.{detectedExt}
   */
  async finalizeBlob(
    tempPath: string,
    checksum: string,
    canonicalExtension: string
  ): Promise<{
    canonicalAbsolutePath: string;
    storageRelativePath: string;
    isDuplicate: boolean;
    isNewCanonicalFile: boolean;
  }> {
    const canonicalAbs = getCanonicalBlobPath(checksum, canonicalExtension);
    const targetDir = path.dirname(canonicalAbs);
    await ensureDir(targetDir);

    const alreadyExists = await pathExists(canonicalAbs);

    if (alreadyExists) {
      await this.removeTempFile(tempPath);
      return {
        canonicalAbsolutePath: canonicalAbs,
        storageRelativePath: toStorageRelativePath(canonicalAbs),
        isDuplicate: true,
        isNewCanonicalFile: false,
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
      isNewCanonicalFile: true,
    };
  },

  /**
   * Performs compensation cleanup if DB transaction fails after THIS upload created a new canonical file.
   */
  async compensateCanonicalBlob(canonicalAbsolutePath: string): Promise<void> {
    try {
      await fs.rm(canonicalAbsolutePath, { force: true });
    } catch (error) {
      logger.error({
        event: "storage.canonical_compensation_failed",
        canonicalAbsolutePath,
        error,
        message: "Failed to remove newly created canonical file after DB transaction failure",
      });
      throw new StorageError(
        `Failed to clean up newly created canonical blob file at ${canonicalAbsolutePath}`,
        {
          canonicalAbsolutePath,
          canonicalOrphaned: true,
          cause: error instanceof Error ? error.message : String(error),
        }
      );
    }
  },

  /**
   * Safely deletes a staged temporary file. Never swallows cleanup errors silently.
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
