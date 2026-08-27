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

export class VoiceStorageService {
  /**
   * Stages a complete audio buffer to a temporary file on the storage volume
   * and atomically publishes it to the content-addressed project audio directory
   * using an exclusive no-clobber primitive (fs.promises.link or COPYFILE_EXCL fallback).
   */
  async stageAndPublishAudio(audioData: Buffer, projectId: string): Promise<PublishAudioResult> {
    if (!audioData || audioData.length === 0) {
      throw new StorageError("Cannot stage empty audio buffer");
    }

    const audioSha256 = crypto.createHash("sha256").update(audioData).digest("hex").toLowerCase();
    const audioByteCount = audioData.length;

    // 1. Ensure temp and target directories exist under storage root
    const tempRoot = getTempRoot();
    await fs.promises.mkdir(tempRoot, { recursive: true });

    const projectAudioDir = getProjectSubdirPath(projectId, "audio");
    await fs.promises.mkdir(projectAudioDir, { recursive: true });

    // 2. Write completely flushed temp file on same volume
    const tempFileName = `voice-stage-${crypto.randomUUID()}.wav`;
    const tempFilePath = path.join(tempRoot, tempFileName);

    await fs.promises.writeFile(tempFilePath, audioData);

    // 3. Define target content-addressed path
    const targetFileName = `${audioSha256}.wav`;
    const targetFilePath = path.join(projectAudioDir, targetFileName);
    const storageRef = toStorageRelativePath(targetFilePath);

    // 4. Atomic exclusive publication
    let newlyCreated = false;
    try {
      try {
        // Primary: atomic hard-link publication on the same volume
        await fs.promises.link(tempFilePath, targetFilePath);
        newlyCreated = true;
      } catch (linkErr: unknown) {
        const err = linkErr as NodeJS.ErrnoException;
        if (err.code === "EEXIST") {
          // File already exists — another operation or prior run created it
          newlyCreated = false;
        } else if (err.code === "EXDEV" || err.code === "EPERM") {
          // Fallback for filesystems that reject hardlinks: atomic exclusive copy
          try {
            await fs.promises.copyFile(tempFilePath, targetFilePath, fs.constants.COPYFILE_EXCL);
            newlyCreated = true;
          } catch (copyErr: unknown) {
            const cErr = copyErr as NodeJS.ErrnoException;
            if (cErr.code === "EEXIST") {
              newlyCreated = false;
            } else {
              throw copyErr;
            }
          }
        } else {
          throw linkErr;
        }
      }
    } finally {
      // 5. Always clean temporary file
      try {
        await fs.promises.unlink(tempFilePath);
      } catch {
        // Ignore unlink error for temp file if already cleaned
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
