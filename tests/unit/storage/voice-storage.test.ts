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
});
