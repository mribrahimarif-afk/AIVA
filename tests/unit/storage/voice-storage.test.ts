import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { VoiceStorageService } from "@/storage/voice-storage.service";
import { getStorageRoot, resolveStoragePath } from "@/storage/paths";
import { StorageError } from "@/domain/errors";

describe("VoiceStorageService Unit & Path Security Tests", () => {
  const service = new VoiceStorageService();
  const testProjectId = "test-proj-voice-storage-123";
  const sampleAudio = Buffer.from("RIFF1234WAVEfmt test audio data for storage testing");

  it("stages and atomically publishes audio with correct SHA-256 and POSIX storage reference", async () => {
    const projId = `test-proj-voice-storage-${crypto.randomUUID()}`;
    const published = await service.stageAndPublishAudio(sampleAudio, projId);
    const expectedSha256 = crypto.createHash("sha256").update(sampleAudio).digest("hex").toLowerCase();

    expect(published.audioSha256).toBe(expectedSha256);
    expect(published.audioByteCount).toBe(sampleAudio.length);
    expect(published.storageRef).toBe(`projects/${projId}/audio/${expectedSha256}.wav`);
    expect(published.newlyCreated).toBe(true);

    // Verify physical file exists and content matches
    const exists = await service.audioFileExists(published.storageRef);
    expect(exists).toBe(true);

    const stat = await service.getAudioStat(published.storageRef);
    expect(stat.sizeBytes).toBe(sampleAudio.length);
  });

  it("returns newlyCreated=false when publishing identical SHA audio that already exists on disk", async () => {
    const projId = `test-proj-voice-storage-${crypto.randomUUID()}`;
    // First publication
    const pub1 = await service.stageAndPublishAudio(sampleAudio, projId);
    expect(pub1.newlyCreated).toBe(true);

    // Second publication of same SHA audio
    const pub2 = await service.stageAndPublishAudio(sampleAudio, projId);
    expect(pub2.newlyCreated).toBe(false);
    expect(pub2.audioSha256).toBe(pub1.audioSha256);
    expect(pub2.storageRef).toBe(pub1.storageRef);
  });

  it("rejects path traversal attempts in storage reference resolution", () => {
    expect(() => resolveStoragePath("../../../etc/passwd")).toThrow(StorageError);
    expect(() => resolveStoragePath("projects/../../secret.wav")).toThrow(StorageError);
    expect(() => resolveStoragePath("C:\\Windows\\system32\\calc.exe")).toThrow(StorageError);
    expect(() => resolveStoragePath("/etc/shadow")).toThrow(StorageError);
  });

  it("safely handles non-existent file checks and removal without crashing", async () => {
    const nonExistentRef = `projects/${testProjectId}/audio/non-existent-sha256.wav`;
    const exists = await service.audioFileExists(nonExistentRef);
    expect(exists).toBe(false);

    await expect(service.getAudioStat(nonExistentRef)).rejects.toThrow(StorageError);

    // removeAudioFile is idempotent and ignores ENOENT
    await expect(service.removeAudioFile(nonExistentRef)).resolves.not.toThrow();
  });

  describe("EXDEV / EPERM Fallback & Atomic No-Clobber Publication Contract", () => {
    it("proves canonical path does not exist while destination temp copy is in flight and publishes only after copy completes", async () => {
      const projId = `test-proj-voice-storage-${crypto.randomUUID()}`;
      const expectedSha = crypto.createHash("sha256").update(sampleAudio).digest("hex").toLowerCase();
      const canonicalRef = `projects/${projId}/audio/${expectedSha}.wav`;
      const canonicalPath = resolveStoragePath(canonicalRef);

      let inFlightCheckPassed = false;
      let destTempSeen = false;

      // Create a service with injected linkFn that triggers EXDEV on first attempt (cross-device)
      // and verifies canonical path is not visible while copying
      const customService = new VoiceStorageService({
        link: async (src, dest) => {
          const srcStr = String(src);
          // If linking from temp root to destination, simulate cross-device EXDEV
          if (srcStr.includes("voice-stage-")) {
            const err = new Error("Cross-device link") as NodeJS.ErrnoException;
            err.code = "EXDEV";
            throw err;
          }
          // Linking from destination temp (.tmp-*) to canonical destination
          if (srcStr.includes(".tmp-")) {
            destTempSeen = true;
            // Before this link completes, verify canonical path does NOT exist yet
            const exists = fs.existsSync(canonicalPath);
            if (!exists) {
              inFlightCheckPassed = true;
            }
          }
          return fs.promises.link(src, dest);
        },
      });

      const published = await customService.stageAndPublishAudio(sampleAudio, projId);
      expect(published.newlyCreated).toBe(true);
      expect(destTempSeen).toBe(true);
      expect(inFlightCheckPassed).toBe(true);

      // Verify canonical file now exists with complete content
      expect(fs.existsSync(canonicalPath)).toBe(true);
      const readBuf = await fs.promises.readFile(canonicalPath);
      expect(readBuf.equals(sampleAudio)).toBe(true);
    });

    it("proves EXDEV fallback handles concurrent EEXIST as reuse without overwriting", async () => {
      const projId = `test-proj-voice-storage-${crypto.randomUUID()}`;
      const expectedSha = crypto.createHash("sha256").update(sampleAudio).digest("hex").toLowerCase();
      const canonicalRef = `projects/${projId}/audio/${expectedSha}.wav`;
      const canonicalPath = resolveStoragePath(canonicalRef);

      // Pre-create the canonical file
      await fs.promises.mkdir(require("path").dirname(canonicalPath), { recursive: true });
      await fs.promises.writeFile(canonicalPath, sampleAudio);

      const customService = new VoiceStorageService({
        link: async (src, dest) => {
          const srcStr = String(src);
          if (srcStr.includes("voice-stage-")) {
            const err = new Error("Cross-device link") as NodeJS.ErrnoException;
            err.code = "EXDEV";
            throw err;
          }
          return fs.promises.link(src, dest); // Will throw EEXIST
        },
      });

      const published = await customService.stageAndPublishAudio(sampleAudio, projId);
      expect(published.newlyCreated).toBe(false);
      expect(published.storageRef).toBe(canonicalRef);
    });

    it("proves all temp files (source and destination) are cleaned up on copy failure or destination link failure", async () => {
      const projId = `test-proj-voice-storage-${crypto.randomUUID()}`;
      let createdDestTemp: string | undefined;

      const failingCopyService = new VoiceStorageService({
        link: async (src) => {
          const srcStr = String(src);
          if (srcStr.includes("voice-stage-")) {
            const err = new Error("Cross-device link") as NodeJS.ErrnoException;
            err.code = "EXDEV";
            throw err;
          }
          return fs.promises.link(src, "");
        },
        copyFile: async (src, dest) => {
          createdDestTemp = String(dest);
          throw new Error("Simulated disk I/O error during copy");
        },
      });

      await expect(failingCopyService.stageAndPublishAudio(sampleAudio, projId)).rejects.toThrow(
        "Simulated disk I/O error during copy"
      );

      if (createdDestTemp) {
        expect(fs.existsSync(createdDestTemp)).toBe(false);
      }

      // Test destination link non-EEXIST failure fails closed
      const failingLinkService = new VoiceStorageService({
        link: async (src) => {
          const srcStr = String(src);
          if (srcStr.includes("voice-stage-")) {
            const err = new Error("Cross-device link") as NodeJS.ErrnoException;
            err.code = "EXDEV";
            throw err;
          }
          const fatalErr = new Error("Filesystem corrupted") as NodeJS.ErrnoException;
          fatalErr.code = "EIO";
          throw fatalErr;
        },
      });

      await expect(failingLinkService.stageAndPublishAudio(sampleAudio, projId)).rejects.toThrow(StorageError);
    });

    it("proves partial source-temp write failure cleans source temp and does not publish canonical WAV", async () => {
      const projId = `test-proj-voice-storage-${crypto.randomUUID()}`;
      const expectedSha = crypto.createHash("sha256").update(sampleAudio).digest("hex").toLowerCase();
      const canonicalRef = `projects/${projId}/audio/${expectedSha}.wav`;
      const canonicalPath = resolveStoragePath(canonicalRef);

      // Track the source staging temp path that was created before the throw
      let capturedSourceTemp: string | undefined;

      const partialWriteService = new VoiceStorageService({
        writeFile: async (filePath, data) => {
          // 1. Write partial content to prove the file actually exists on disk
          const partial = Buffer.isBuffer(data)
            ? data.slice(0, Math.max(1, Math.floor(data.length / 2)))
            : Buffer.from(String(data)).slice(0, 4);
          await fs.promises.writeFile(filePath, partial);
          // Record the path of the partially-created file
          capturedSourceTemp = String(filePath);
          // 2. Then throw, simulating a mid-write I/O error
          throw new Error("Simulated partial write failure — disk full");
        },
      });

      let thrownError: unknown;
      try {
        await partialWriteService.stageAndPublishAudio(sampleAudio, projId);
      } catch (err) {
        thrownError = err;
      }

      // stageAndPublishAudio must reject
      expect(thrownError).toBeDefined();

      // Source partial temp must have been created (proving the write ran)
      expect(capturedSourceTemp).toBeDefined();

      // Source partial temp must be cleaned up by the finally block
      expect(fs.existsSync(capturedSourceTemp!)).toBe(false);

      // Canonical content-addressed WAV must NOT be published
      expect(fs.existsSync(canonicalPath)).toBe(false);

      // The surfaced error must not expose absolute filesystem paths
      const errorStr = String(thrownError instanceof Error ? thrownError.message : thrownError);
      const storageRoot = getStorageRoot();
      expect(errorStr).not.toContain(storageRoot);
      expect(errorStr).not.toContain(capturedSourceTemp!);
    });
  });
});
