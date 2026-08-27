import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createDirectorPlanRepository } from "@/repositories/director-plan.repository";
import { createVoiceTrackRepository, VoiceTrackRepository } from "@/repositories/voice-track.repository";
import { VoiceService } from "@/services/voice.service";
import { FakeVoiceProvider } from "../../mocks/fake-voice.provider";
import { voiceStorageService } from "@/storage/voice-storage.service";

describe("VoiceService File Compensation & Safe Orphan Tests (Test B)", () => {
  const projectRepo = createProjectRepository(prisma);
  const directorPlanRepo = createDirectorPlanRepository(prisma);
  const realVoiceTrackRepo = createVoiceTrackRepository(prisma);

  beforeEach(async () => {
    await prisma.voiceBoundary.deleteMany({});
    await prisma.voiceTrack.deleteMany({});
    await prisma.directorScene.deleteMany({});
    await prisma.directorPlan.deleteMany({});
    await prisma.scene.deleteMany({});
    await prisma.project.deleteMany({});
  });

  afterEach(async () => {
    await prisma.voiceBoundary.deleteMany({});
    await prisma.voiceTrack.deleteMany({});
    await prisma.directorScene.deleteMany({});
    await prisma.directorPlan.deleteMany({});
    await prisma.scene.deleteMany({});
    await prisma.project.deleteMany({});
  });

  it("preserves previous valid VoiceTrack and audio when a repository failure occurs during replacement", async () => {
    const script = "Sample narration text for compensation testing.";
    const scriptHash = crypto.createHash("sha256").update(script).digest("hex").toLowerCase();

    const project = await projectRepo.create({
      name: "Compensation Test Project",
      aspectRatio: "9:16",
      script,
    });

    await directorPlanRepo.replacePlan(
      project.id,
      {
        projectId: project.id,
        originalScript: script,
        scriptHash,
        unitizerVersion: "unitizer-v1",
        schemaVersion: "director-v1",
        promptVersion: "director-v1",
        model: "gemini-3.7-flash",
        language: "ENGLISH",
        contentType: "ADVERTISEMENT",
        summary: "Summary",
        creativeDirection: "Direction",
      },
      []
    );

    // 1. Generate an initial valid VoiceTrack
    const initialService = new VoiceService({
      projectRepository: projectRepo,
      directorPlanRepository: directorPlanRepo,
      voiceTrackRepository: realVoiceTrackRepo,
      voiceProvider: new FakeVoiceProvider({ isConfigured: true }),
      voiceStorageService,
    });

    const initialTrack = await initialService.generateVoice(project.id);
    const initialAudioExists = await voiceStorageService.audioFileExists(initialTrack.audioStorageRef);
    expect(initialAudioExists).toBe(true);

    // 2. Configure a failing repository test double to simulate DB failure during replaceTrack
    const failingRepo: VoiceTrackRepository = {
      ...realVoiceTrackRepo,
      async replaceTrack() {
        throw new Error("Simulated database failure during replaceTrack");
      },
    };

    const failingService = new VoiceService({
      projectRepository: projectRepo,
      directorPlanRepository: directorPlanRepo,
      voiceTrackRepository: failingRepo,
      voiceProvider: new FakeVoiceProvider({ isConfigured: true }),
      voiceStorageService,
    });

    // 3. Attempt forced regeneration
    await expect(failingService.generateVoice(project.id, { force: true })).rejects.toThrow(
      "Simulated database failure during replaceTrack"
    );

    // 4. Verify old valid audio file STILL exists on disk and old DB record is intact
    const oldAudioStillExists = await voiceStorageService.audioFileExists(initialTrack.audioStorageRef);
    expect(oldAudioStillExists).toBe(true);

    const survivingDbTrack = await realVoiceTrackRepo.getCurrentForProject(project.id);
    expect(survivingDbTrack).not.toBeNull();
    expect(survivingDbTrack!.audioStorageRef).toBe(initialTrack.audioStorageRef);
  });
});
