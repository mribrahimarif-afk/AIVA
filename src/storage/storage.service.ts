import fs from "node:fs/promises";
import createReadStream from "node:fs";
import path from "node:path";
import crypto, { randomUUID } from "node:crypto";
import { Readable, once } from "node:stream";
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

export interface FinalizeBlobResult {
  canonicalAbsolutePath: string;
  storageRelativePath: string;
  isDuplicate: boolean;
  isNewCanonicalFile: boolean;
  createdByThisUpload: boolean;
  tempCleanupFailed: boolean;
  tempCleanupErrorMessage?: string;
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
   * Respects stream backpressure ('drain' event) and handles stream aborts safely.
   */
  async stageStream(
    stream: ReadableStream<Uint8Array> | Readable,
    originalFilename: string
  ): Promise<StagedUploadResult> {
    const env = getEnv();
    await ensureDir(getTempRoot());
    const sanitizedFilename = path.basename(originalFilename).replace(/[^a-zA-Z0-9_.-]/g, "_");
    const extension = path.extname(sanitizedFilename) || ".bin";
    const tempPath = path.join(getTempRoot(), `upload-${randomUUID()}-${sanitizedFilename}`);

    const hash = crypto.createHash("sha256");
    const writeStream = createReadStream.createWriteStream(tempPath);
    const leadingChunks: Buffer[] = [];
    let leadingBytesCount = 0;
    let totalBytes = 0;

    try {
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
          throw new ValidationError(
            `Upload exceeded maximum allowed size limit of ${env.AIVA_MAX_UPLOAD_BYTES} bytes`
          );
        }

        hash.update(buf);

        // Bounded-memory backpressure handling
        const canWriteMore = writeStream.write(buf);
        if (!canWriteMore) {
          await once(writeStream, "drain");
        }

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
    } catch (primaryError) {
      writeStream.destroy();
      let cleanupFailed = false;
      let cleanupErrorMessage = "";
      try {
        await fs.rm(tempPath, { force: true });
      } catch (rmErr) {
        cleanupFailed = true;
        cleanupErrorMessage = rmErr instanceof Error ? rmErr.message : String(rmErr);
      }

      if (cleanupFailed) {
        throw new StorageError(
          `Upload streaming failed, and temporary file cleanup also failed; temporary file is orphaned at '${tempPath}'`,
          {
            tempPath,
            partialUploadOrphaned: true,
            primaryCause: primaryError instanceof Error ? primaryError.message : String(primaryError),
            cleanupCause: cleanupErrorMessage,
          }
        );
      }

      if (primaryError instanceof ValidationError) throw primaryError;
      throw new StorageError(`Failed to stream upload payload to temporary storage: ${sanitizedFilename}`, {
        tempPath,
        cause: primaryError instanceof Error ? primaryError.message : String(primaryError),
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
   * Explicit 2-Phase Finalize State Machine:
   * Phase A: Exclusive canonical file creation (COPYFILE_EXCL).
   * Phase B: Temp file cleanup.
   * Returns a structured FinalizeBlobResult so creator state is never lost if Phase B fails.
   */
  async finalizeBlob(
    tempPath: string,
    checksum: string,
    canonicalExtension: string
  ): Promise<FinalizeBlobResult> {
    const canonicalAbs = getCanonicalBlobPath(checksum, canonicalExtension);
    const targetDir = path.dirname(canonicalAbs);
    await ensureDir(targetDir);

    let createdByThisUpload = false;
    let isEexist = false;
    let phaseACopyError: Error | null = null;

    // Phase A: Exclusive Canonical Creation
    try {
      await fs.copyFile(tempPath, canonicalAbs, fs.constants.COPYFILE_EXCL);
      createdByThisUpload = true;
    } catch (copyError) {
      isEexist =
        typeof copyError === "object" &&
        copyError !== null &&
        "code" in copyError &&
        (copyError as { code: unknown }).code === "EEXIST";

      if (!isEexist) {
        phaseACopyError = copyError instanceof Error ? copyError : new Error(String(copyError));
      }
    }

    // Phase A Failed (non-EEXIST) -> Attempt temp cleanup and throw Phase A error
    if (phaseACopyError) {
      let cleanupFailed = false;
      let cleanupErrMessage = "";
      try {
        await fs.rm(tempPath, { force: true });
      } catch (rmErr) {
        cleanupFailed = true;
        cleanupErrMessage = rmErr instanceof Error ? rmErr.message : String(rmErr);
      }

      if (cleanupFailed) {
        throw new StorageError(
          `Failed to create canonical blob file at ${canonicalAbs}, and temp cleanup also failed; temp file is orphaned at ${tempPath}`,
          {
            canonicalCreated: false,
            createdByThisUpload: false,
            tempPath,
            canonicalAbsolutePath: canonicalAbs,
            partialUploadOrphaned: true,
            copyCause: phaseACopyError.message,
            cleanupCause: cleanupErrMessage,
          }
        );
      }

      throw new StorageError(`Failed to create canonical blob file at ${canonicalAbs}`, {
        canonicalCreated: false,
        createdByThisUpload: false,
        tempPath,
        canonicalAbsolutePath: canonicalAbs,
        cause: phaseACopyError.message,
      });
    }

    // Phase B: Temp File Cleanup
    let phaseBCleanupError: Error | null = null;
    try {
      await fs.rm(tempPath, { force: true });
    } catch (rmErr) {
      phaseBCleanupError = rmErr instanceof Error ? rmErr : new Error(String(rmErr));
    }

    return {
      canonicalAbsolutePath: canonicalAbs,
      storageRelativePath: toStorageRelativePath(canonicalAbs),
      isDuplicate: !createdByThisUpload,
      isNewCanonicalFile: createdByThisUpload,
      createdByThisUpload,
      tempCleanupFailed: phaseBCleanupError !== null,
      tempCleanupErrorMessage: phaseBCleanupError ? phaseBCleanupError.message : undefined,
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

  /**
   * Resolves storage-relative path and retrieves stat information.
   */
  async getBlobStat(storageRelativePath: string): Promise<{ sizeBytes: number; isFile: boolean }> {
    const absPath = resolveStoragePath(storageRelativePath);
    try {
      const stat = await fs.stat(absPath);
      return { sizeBytes: stat.size, isFile: stat.isFile() };
    } catch (error) {
      throw new StorageError(`Failed to stat storage file: ${storageRelativePath}`, {
        storageRelativePath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  },

  /**
   * Creates a read stream for a storage-relative file.
   */
  createBlobReadStream(
    storageRelativePath: string,
    options?: { start?: number; end?: number }
  ): Readable {
    const absPath = resolveStoragePath(storageRelativePath);
    return createReadStream.createReadStream(absPath, options);
  },

  pathExists,
  getStorageRoot,
  getProjectWorkspacePath,
  toStorageRelativePath,
  resolveStoragePath,
};
