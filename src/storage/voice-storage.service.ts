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

export interface PublishAudioResult {
  storageRef: string;
  audioSha256: string;
  audioByteCount: number;
  newlyCreated: boolean;
}

export interface VoiceStorageFsOps {
  link?: typeof fs.promises.link;
  copyFile?: typeof fs.promises.copyFile;
  unlink?: typeof fs.promises.unlink;
  writeFile?: typeof fs.promises.writeFile;
  mkdir?: typeof fs.promises.mkdir;
}

export class VoiceStorageService {
  private readonly linkFn: typeof fs.promises.link;
  private readonly copyFileFn: typeof fs.promises.copyFile;
  private readonly unlinkFn: typeof fs.promises.unlink;
  private readonly writeFileFn: typeof fs.promises.writeFile;
  private readonly mkdirFn: typeof fs.promises.mkdir;

  constructor(fsOps?: VoiceStorageFsOps) {
    this.linkFn = fsOps?.link ?? fs.promises.link;
    this.copyFileFn = fsOps?.copyFile ?? fs.promises.copyFile;
    this.unlinkFn = fsOps?.unlink ?? fs.promises.unlink;
    this.writeFileFn = fsOps?.writeFile ?? fs.promises.writeFile;
    this.mkdirFn = fsOps?.mkdir ?? fs.promises.mkdir;
  }

  /**
   * Stages a complete audio buffer to a temporary file on the storage volume
   * and atomically publishes it to the content-addressed project audio directory
   * using an exclusive no-clobber primitive (fs.promises.link with same-volume dest temp fallback).
   */
  async stageAndPublishAudio(audioData: Buffer, projectId: string): Promise<PublishAudioResult> {
    if (!audioData || audioData.length === 0) {
      throw new StorageError("Cannot stage empty audio buffer");
    }

    const audioSha256 = crypto.createHash("sha256").update(audioData).digest("hex").toLowerCase();
    const audioByteCount = audioData.length;

    // 1. Ensure temp and target directories exist under storage root
    const tempRoot = getTempRoot();
    await this.mkdirFn(tempRoot, { recursive: true });

    const projectAudioDir = getProjectSubdirPath(projectId, "audio");
    await this.mkdirFn(projectAudioDir, { recursive: true });

    // 2. Define source temp path and target content-addressed path
    const tempFileName = `voice-stage-${crypto.randomUUID()}.wav`;
    const tempFilePath = path.join(tempRoot, tempFileName);

    const targetFileName = `${audioSha256}.wav`;
    const targetFilePath = path.join(projectAudioDir, targetFileName);
    const storageRef = toStorageRelativePath(targetFilePath);

    // 3. Cleanup ownership begins BEFORE the source write.
    //    Every failure path — including a partial source write — will reach this finally.
    let newlyCreated = false;
    let destTempFilePath: string | undefined;

    try {
      // Write completely flushed source temp file; cleanup is guaranteed from this point.
      await this.writeFileFn(tempFilePath, audioData);

      // 4. Atomic exclusive publication
      try {
        // Primary: atomic hard-link publication from tempRoot to destination
        await this.linkFn(tempFilePath, targetFilePath);
        newlyCreated = true;
      } catch (linkErr: unknown) {
        const err = linkErr as NodeJS.ErrnoException;
        if (err.code === "EEXIST") {
          // File already exists — another operation or prior run created it
          newlyCreated = false;
        } else if (err.code === "EXDEV" || err.code === "EPERM") {
          // Fallback for cross-device/partition links:
          // 1. Create a unique temporary filename inside the destination audio directory
          destTempFilePath = path.join(projectAudioDir, `.tmp-${crypto.randomUUID()}.wav`);
          // 2. Copy the fully-written source temp WAV into destination-directory temp file
          await this.copyFileFn(tempFilePath, destTempFilePath);
          // 3. Publish that fully-written destination temp into canonical path via atomic link
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
      // 5. Always clean operation-owned temporary files, ENOENT tolerated.
      //    Canonical content-addressed WAVs are never touched here.
      if (destTempFilePath) {
        try {
          await this.unlinkFn(destTempFilePath);
        } catch {
          // Ignore unlink error for destination temp file (ENOENT or already cleaned)
        }
      }
      try {
        await this.unlinkFn(tempFilePath);
      } catch {
        // Ignore unlink error for source temp file (ENOENT or already cleaned)
      }
    }

    return {
      storageRef,
      audioSha256,
      audioByteCount,
      newlyCreated,
    };
  }

  /**
   * Safely deletes an audio file given a storage relative path.
   */
  async removeAudioFile(storageRef: string): Promise<void> {
    try {
      const resolvedPath = resolveStoragePath(storageRef);
      await fs.promises.unlink(resolvedPath);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "ENOENT") {
        throw new StorageError(`Failed to remove audio file: ${storageRef}`, { cause: error });
      }
    }
  }

  /**
   * Resolves storage reference and checks if the physical file exists.
   */
  async audioFileExists(storageRef: string): Promise<boolean> {
    try {
      const resolvedPath = resolveStoragePath(storageRef);
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves storage reference and gets file stat (size in bytes).
   */
  async getAudioStat(storageRef: string): Promise<{ sizeBytes: number }> {
    const resolvedPath = resolveStoragePath(storageRef);
    try {
      const stat = await fs.promises.stat(resolvedPath);
      return { sizeBytes: stat.size };
    } catch (err: unknown) {
      throw new StorageError(`Audio file not found: ${storageRef}`, { cause: err });
    }
  }

  /**
   * Creates a readable stream for the audio file.
   */
  createAudioReadStream(storageRef: string): fs.ReadStream {
    const resolvedPath = resolveStoragePath(storageRef);
    return fs.createReadStream(resolvedPath);
  }
}

export const voiceStorageService = new VoiceStorageService();
