import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createDirectorPlanRepository } from "@/repositories/director-plan.repository";
import { createVoiceTrackRepository } from "@/repositories/voice-track.repository";
import { VoiceService } from "@/services/voice.service";
import { FakeVoiceProvider } from "../../mocks/fake-voice.provider";
import { voiceStorageService } from "@/storage/voice-storage.service";
import { DomainError } from "@/domain/errors";

describe("Voice In-Transaction TOCTOU & Concurrency Race Tests", () => {
  const projectRepo = createProjectRepository(prisma);
  const directorPlanRepo = createDirectorPlanRepository(prisma);
  const voiceTrackRepo = createVoiceTrackRepository(prisma);

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

  it("aborts persistence with SOURCE_CHANGED when DirectorPlan scriptHash changes mid-flight", async () => {
    const scriptA = "Initial script A for voice generation.";
    const scriptAHash = crypto.createHash("sha256").update(scriptA).digest("hex").toLowerCase();

    const scriptB = "Re-analyzed script B before voice persistence completes.";
    const scriptBHash = crypto.createHash("sha256").update(scriptB).digest("hex").toLowerCase();

    const project = await projectRepo.create({
      name: "Concurrency Test Project",
      aspectRatio: "9:16",
      script: scriptA,
    });

    await directorPlanRepo.replacePlan(
      project.id,
      {
        projectId: project.id,
        originalScript: scriptA,
        scriptHash: scriptAHash,
        unitizerVersion: "unitizer-v1",
        schemaVersion: "director-v1",
        promptVersion: "director-v1",
        model: "gemini-3.7-flash",
        language: "ENGLISH",
        contentType: "ADVERTISEMENT",
        summary: "Summary A",
        creativeDirection: "Direction A",
      },
      []
    );

    // Provider that simulates mutation of DirectorPlan mid-flight before voice persistence
    const mutatingProvider = new FakeVoiceProvider({
      isConfigured: true,
      onSynthesize: async () => {
        // Re-analyze DirectorPlan concurrently while synthesis is in flight
        await directorPlanRepo.replacePlan(
          project.id,
          {
            projectId: project.id,
            originalScript: scriptB,
            scriptHash: scriptBHash,
            unitizerVersion: "unitizer-v1",
            schemaVersion: "director-v1",
            promptVersion: "director-v1",
            model: "gemini-3.7-flash",
            language: "ENGLISH",
            contentType: "ADVERTISEMENT",
            summary: "Summary B",
            creativeDirection: "Direction B",
          },
          []
        );
      },
    });

    const voiceService = new VoiceService({
      projectRepository: projectRepo,
      directorPlanRepository: directorPlanRepo,
      voiceTrackRepository: voiceTrackRepo,
      voiceProvider: mutatingProvider,
      voiceStorageService,
    });

    try {
      await voiceService.generateVoice(project.id);
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("SOURCE_CHANGED");
    }

    // Verify no stale voice track was persisted
    const currentTrack = await voiceTrackRepo.getCurrentForProject(project.id);
    expect(currentTrack).toBeNull();
  });
});
