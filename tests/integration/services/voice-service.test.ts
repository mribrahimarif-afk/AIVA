import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createDirectorPlanRepository } from "@/repositories/director-plan.repository";
import { createVoiceTrackRepository } from "@/repositories/voice-track.repository";
import { VoiceService } from "@/services/voice.service";
import { FakeVoiceProvider } from "../../mocks/fake-voice.provider";
import { voiceStorageService } from "@/storage/voice-storage.service";
import { DomainError, NotFoundError, ProviderError } from "@/domain/errors";

describe("VoiceService Integration & Atomicity Tests", () => {
  const projectRepo = createProjectRepository(prisma);
  const directorPlanRepo = createDirectorPlanRepository(prisma);
  const voiceTrackRepo = createVoiceTrackRepository(prisma);

  let fakeVoiceProvider: FakeVoiceProvider;
  let voiceService: VoiceService;

  beforeEach(async () => {
    fakeVoiceProvider = new FakeVoiceProvider({ isConfigured: true });
    voiceService = new VoiceService({
      projectRepository: projectRepo,
      directorPlanRepository: directorPlanRepo,
      voiceTrackRepository: voiceTrackRepo,
      voiceProvider: fakeVoiceProvider,
      voiceStorageService,
    });

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

  it("fails with DIRECTOR_PLAN_REQUIRED when generating voice for project without a DirectorPlan", async () => {
    const project = await projectRepo.create({
      name: "No Director Project",
      aspectRatio: "9:16",
      script: "Some script without director plan",
    });

    await expect(voiceService.generateVoice(project.id)).rejects.toThrow(DomainError);

    try {
      await voiceService.generateVoice(project.id);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("DIRECTOR_PLAN_REQUIRED");
    }
  });

  it("fails with NotFoundError when generating voice for non-existent project", async () => {
    await expect(voiceService.generateVoice("non-existent-id")).rejects.toThrow(NotFoundError);
  });

  it("fails with VOICE_UNCONFIGURED when voiceProvider is not configured", async () => {
    const unconfiguredService = new VoiceService({
      projectRepository: projectRepo,
      directorPlanRepository: directorPlanRepo,
      voiceTrackRepository: voiceTrackRepo,
      voiceProvider: new FakeVoiceProvider({ isConfigured: false }),
      voiceStorageService,
    });

    const script = "Sample narration text for AIVA testing.";
    const scriptHash = crypto.createHash("sha256").update(script).digest("hex").toLowerCase();

    const project = await projectRepo.create({
      name: "Unconfigured Test Project",
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
        summary: "Commercial summary",
        creativeDirection: "Creative direction",
      },
      []
    );

    try {
      await unconfiguredService.generateVoice(project.id);
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("VOICE_UNCONFIGURED");
    }
  });

  it("successfully synthesizes, validates, stores WAV audio, and persists VoiceTrack with boundaries", async () => {
    const script = "AIVA Studio creates high quality video voiceovers.";
    const scriptHash = crypto.createHash("sha256").update(script).digest("hex").toLowerCase();

    const project = await projectRepo.create({
      name: "Voice Test Project",
      aspectRatio: "9:16",
      script,
    });

    const plan = await directorPlanRepo.replacePlan(
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
        summary: "Voice summary",
        creativeDirection: "Voice creative direction",
      },
      []
    );

    const voiceTrack = await voiceService.generateVoice(project.id, {
      voiceName: "ur-PK-AsadNeural",
    });

    expect(voiceTrack).not.toBeNull();
    expect(voiceTrack.projectId).toBe(project.id);
    expect(voiceTrack.directorPlanId).toBe(plan.id);
    expect(voiceTrack.sourceScriptHash).toBe(scriptHash);
    expect(voiceTrack.voiceName).toBe("ur-PK-AsadNeural");
    expect(voiceTrack.state).toBe("CURRENT");
    expect(voiceTrack.boundaryCount).toBeGreaterThan(0);
    expect(voiceTrack.audioSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(voiceTrack.audioStorageRef).toBe(`projects/${project.id}/audio/${voiceTrack.audioSha256}.wav`);

    // Verify physical audio file was written
    const exists = await voiceStorageService.audioFileExists(voiceTrack.audioStorageRef);
    expect(exists).toBe(true);

    // Verify track with boundaries can be loaded back
    const loaded = await voiceService.getVoiceTrackWithBoundaries(project.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.boundaries.length).toBe(voiceTrack.boundaryCount);
    expect(loaded!.boundaries[0]?.order).toBe(1);
    expect(loaded!.boundaries[0]?.text).toBe("AIVA");
  });

  it("re-uses existing identical track without calling voiceProvider when force is false", async () => {
    const script = "Idempotent voice reuse test script.";
    const scriptHash = crypto.createHash("sha256").update(script).digest("hex").toLowerCase();

    const project = await projectRepo.create({
      name: "Reuse Test Project",
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
        summary: "Reuse summary",
        creativeDirection: "Reuse direction",
      },
      []
    );

    let synthesisCallCount = 0;
    const trackingProvider = new FakeVoiceProvider({
      isConfigured: true,
      onSynthesize: () => {
        synthesisCallCount++;
      },
    });

    const trackingService = new VoiceService({
      projectRepository: projectRepo,
      directorPlanRepository: directorPlanRepo,
      voiceTrackRepository: voiceTrackRepo,
      voiceProvider: trackingProvider,
      voiceStorageService,
    });

    // First generation -> calls provider
    const track1 = await trackingService.generateVoice(project.id, { force: false });
    expect(synthesisCallCount).toBe(1);

    // Second generation with same voice and same scriptHash -> reuses without calling provider
    const track2 = await trackingService.generateVoice(project.id, { force: false });
    expect(synthesisCallCount).toBe(1); // Provider NOT called again
    expect(track2.id).toBe(track1.id);
    expect(track2.audioSha256).toBe(track1.audioSha256);

    // Forced regeneration -> calls provider
    const track3 = await trackingService.generateVoice(project.id, { force: true });
    expect(synthesisCallCount).toBe(2);
  });

  it("detects STALE state when DirectorPlan scriptHash changes after voice generation", async () => {
    const script1 = "Original narration script.";
    const script1Hash = crypto.createHash("sha256").update(script1).digest("hex").toLowerCase();

    const project = await projectRepo.create({
      name: "Stale Test Project",
      aspectRatio: "9:16",
      script: script1,
    });

    await directorPlanRepo.replacePlan(
      project.id,
      {
        projectId: project.id,
        originalScript: script1,
        scriptHash: script1Hash,
        unitizerVersion: "unitizer-v1",
        schemaVersion: "director-v1",
        promptVersion: "director-v1",
        model: "gemini-3.7-flash",
        language: "ENGLISH",
        contentType: "ADVERTISEMENT",
        summary: "Summary 1",
        creativeDirection: "Direction 1",
      },
      []
    );

    const track1 = await voiceService.generateVoice(project.id);
    expect(track1.state).toBe("CURRENT");

    // Re-analyze Director with a new script
    const script2 = "Updated narration script with different content.";
    const script2Hash = crypto.createHash("sha256").update(script2).digest("hex").toLowerCase();

    await directorPlanRepo.replacePlan(
      project.id,
      {
        projectId: project.id,
        originalScript: script2,
        scriptHash: script2Hash,
        unitizerVersion: "unitizer-v1",
        schemaVersion: "director-v1",
        promptVersion: "director-v1",
        model: "gemini-3.7-flash",
        language: "ENGLISH",
        contentType: "ADVERTISEMENT",
        summary: "Summary 2",
        creativeDirection: "Direction 2",
      },
      []
    );

    // Reading voice track now reports STALE
    const loadedTrack = await voiceService.getVoiceTrack(project.id);
    expect(loadedTrack).not.toBeNull();
    expect(loadedTrack!.state).toBe("STALE");
    expect(loadedTrack!.sourceScriptHash).toBe(script1Hash);
  });

  describe("Idempotent Reuse Contract Guard Tests", () => {
    it("proves regeneration occurs when provider, outputFormat, voice, or audio file missing differs", async () => {
      const script = "Strict contract variation test script.";
      const scriptHash = crypto.createHash("sha256").update(script).digest("hex").toLowerCase();

      const project = await projectRepo.create({
        name: "Reuse Contract Test Project",
        aspectRatio: "9:16",
        script,
      });

      const plan = await directorPlanRepo.replacePlan(
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
          summary: "Contract summary",
          creativeDirection: "Contract direction",
        },
        []
      );

      let synthesisCount = 0;
      const fakeProvider = new FakeVoiceProvider({
        isConfigured: true,
        onSynthesize: () => {
          synthesisCount++;
        },
      });

      const testService = new VoiceService({
        projectRepository: projectRepo,
        directorPlanRepository: directorPlanRepo,
        voiceTrackRepository: voiceTrackRepo,
        voiceProvider: fakeProvider,
        voiceStorageService,
      });

      // Initial generation
      const t1 = await testService.generateVoice(project.id, { voiceName: "ur-PK-AsadNeural" });
      expect(synthesisCount).toBe(1);

      // Case 1: Different voice requested -> must synthesize
      await testService.generateVoice(project.id, { voiceName: "ur-PK-UzmaNeural" });
      expect(synthesisCount).toBe(2);

      // Case 2: Audio file deleted from disk -> must synthesize even with identical parameters
      await voiceStorageService.removeAudioFile(t1.audioStorageRef);
      await testService.generateVoice(project.id, { voiceName: "ur-PK-UzmaNeural" });
      expect(synthesisCount).toBe(3);

      // Case 3: Provider mismatch in DB -> must synthesize
      // Manually mutate existing track in DB to have different provider
      await prisma.voiceTrack.update({
        where: { id: (await voiceTrackRepo.getCurrentForProject(project.id))!.id },
        data: { provider: "different-provider-id" },
      });
      await testService.generateVoice(project.id, { voiceName: "ur-PK-UzmaNeural" });
      expect(synthesisCount).toBe(4);

      // Case 4: OutputFormat mismatch in DB -> must synthesize
      await prisma.voiceTrack.update({
        where: { id: (await voiceTrackRepo.getCurrentForProject(project.id))!.id },
        data: { outputFormat: "Riff16Khz16BitMonoPcm" },
      });
      await testService.generateVoice(project.id, { voiceName: "ur-PK-UzmaNeural" });
      expect(synthesisCount).toBe(5);
    });
  });
});
