import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { StorageError } from "@/domain/errors";
import {
  getProjectSubdirPath,
  getTempRoot,
  resolveStoragePath,
  toStorageRelativePath,
} from "./paths";

export interface PublishAudioSourceResult {
  storageRef: string;
  sourceHash: string;
  sizeBytes: number;
  newlyCreated: boolean;
}

export interface AudioSourceStorageFsOps {
  link?: typeof fs.promises.link;
  copyFile?: typeof fs.promises.copyFile;
  unlink?: typeof fs.promises.unlink;
  writeFile?: typeof fs.promises.writeFile;
  mkdir?: typeof fs.promises.mkdir;
}

export class AudioSourceStorageService {
  private readonly linkFn: typeof fs.promises.link;
  private readonly copyFileFn: typeof fs.promises.copyFile;
  private readonly unlinkFn: typeof fs.promises.unlink;
  private readonly writeFileFn: typeof fs.promises.writeFile;
  private readonly mkdirFn: typeof fs.promises.mkdir;

  constructor(fsOps?: AudioSourceStorageFsOps) {
    this.linkFn = fsOps?.link ?? fs.promises.link;
    this.copyFileFn = fsOps?.copyFile ?? fs.promises.copyFile;
    this.unlinkFn = fsOps?.unlink ?? fs.promises.unlink;
    this.writeFileFn = fsOps?.writeFile ?? fs.promises.writeFile;
    this.mkdirFn = fsOps?.mkdir ?? fs.promises.mkdir;
  }

  /**
   * Stages an uploaded audio buffer and atomically publishes it to the content-addressed
   * project source directory using atomic hard-link publication.
   */
  async stageAndPublishAudioSource(
    audioData: Buffer,
    projectId: string,
    extension: string
  ): Promise<PublishAudioSourceResult> {
    if (!audioData || audioData.length === 0) {
      throw new StorageError("Cannot stage empty audio buffer");
    }

    const sourceHash = crypto.createHash("sha256").update(audioData).digest("hex").toLowerCase();
    const sizeBytes = audioData.length;

    // 1. Ensure temp and target directories exist under storage root
    const tempRoot = getTempRoot();
    await this.mkdirFn(tempRoot, { recursive: true });

    const projectSourceDir = getProjectSubdirPath(projectId, "source");
    await this.mkdirFn(projectSourceDir, { recursive: true });

    // 2. Define source temp path and target content-addressed path
    const cleanExt = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    const tempFileName = `audio-src-stage-${crypto.randomUUID()}${cleanExt}`;
    const tempFilePath = path.join(tempRoot, tempFileName);

    const targetFileName = `${sourceHash}${cleanExt}`;
    const targetFilePath = path.join(projectSourceDir, targetFileName);
    const storageRef = toStorageRelativePath(targetFilePath);

    let newlyCreated = false;
    let destTempFilePath: string | undefined;

    try {
      // Write completely flushed source temp file
      await this.writeFileFn(tempFilePath, audioData);

      // 4. Atomic exclusive publication
      try {
        await this.linkFn(tempFilePath, targetFilePath);
        newlyCreated = true;
      } catch (linkErr: unknown) {
        const err = linkErr as NodeJS.ErrnoException;
        if (err.code === "EEXIST") {
          newlyCreated = false;
        } else if (err.code === "EXDEV" || err.code === "EPERM") {
          // Fallback for cross-device/partition links
          destTempFilePath = path.join(projectSourceDir, `.tmp-${crypto.randomUUID()}${cleanExt}`);
          await this.copyFileFn(tempFilePath, destTempFilePath);
          try {
            await this.linkFn(destTempFilePath, targetFilePath);
            newlyCreated = true;
          } catch (destLinkErr: unknown) {
            const dErr = destLinkErr as NodeJS.ErrnoException;
            if (dErr.code === "EEXIST") {
              newlyCreated = false;
            } else {
              throw new StorageError("Atomic no-clobber publication unavailable on destination filesystem", {
                cause: destLinkErr,
              });
            }
          }
        } else {
          throw linkErr;
        }
      }
    } finally {
      // Clean temporary staging files
      if (destTempFilePath) {
        try {
          await this.unlinkFn(destTempFilePath);
        } catch {
          // Ignore unlink error for destination temp file
        }
      }
      try {
        await this.unlinkFn(tempFilePath);
      } catch {
        // Ignore unlink error for source temp file
      }
    }

    return {
      storageRef,
      sourceHash,
      sizeBytes,
      newlyCreated,
    };
  }

  /**
   * Resolves storage reference and checks if physical file exists.
   */
  async audioSourceExists(storageRef: string): Promise<boolean> {
    try {
      const resolvedPath = resolveStoragePath(storageRef);
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads the full audio buffer from storage.
   */
  async readAudioSourceBuffer(storageRef: string): Promise<Buffer> {
    const resolvedPath = resolveStoragePath(storageRef);
    try {
      return await fs.promises.readFile(resolvedPath);
    } catch (err: unknown) {
      throw new StorageError(`Failed to read audio source: ${storageRef}`, { cause: err });
    }
  }

  /**
   * Creates a readable stream for the audio source file.
   */
  createAudioSourceReadStream(storageRef: string): fs.ReadStream {
    const resolvedPath = resolveStoragePath(storageRef);
    return fs.createReadStream(resolvedPath);
  }

  /**
   * Resolves storage reference to absolute path (for internal provider transports).
   */
  resolveAbsolutePath(storageRef: string): string {
    return resolveStoragePath(storageRef);
  }
}

export const audioSourceStorageService = new AudioSourceStorageService();
