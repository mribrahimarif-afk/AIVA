import { describe, it, expect } from "vitest";
import { VoiceStorageService } from "@/storage/voice-storage.service";

describe("Voice Storage Atomic No-Clobber Concurrency Tests", () => {
  const service = new VoiceStorageService();
  const testProjectId = "test-proj-storage-concurrency-123";
  const sharedAudio = Buffer.from("RIFF_CONCURRENT_AUDIO_BUFFER_DATA_FOR_NO_CLOBBER_VERIFICATION");

  it("handles concurrent same-SHA publications with atomic no-clobber and exclusive ownership", async () => {
    // Run two concurrent publications of identical audio buffer
    const [resultA, resultB] = await Promise.all([
      service.stageAndPublishAudio(sharedAudio, testProjectId),
      service.stageAndPublishAudio(sharedAudio, testProjectId),
    ]);

    expect(resultA.storageRef).toBe(resultB.storageRef);
    expect(resultA.audioSha256).toBe(resultB.audioSha256);

    // Exactly one winner gets newlyCreated=true; the other gets newlyCreated=false
    const results = [resultA.newlyCreated, resultB.newlyCreated];
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((v) => !v)).toHaveLength(1);

    // Verify physical file exists and is intact
    const exists = await service.audioFileExists(resultA.storageRef);
    expect(exists).toBe(true);

    const stat = await service.getAudioStat(resultA.storageRef);
    expect(stat.sizeBytes).toBe(sharedAudio.length);
  });
});
