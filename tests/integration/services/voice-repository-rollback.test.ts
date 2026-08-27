import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createDirectorPlanRepository } from "@/repositories/director-plan.repository";
import { createVoiceTrackRepository } from "@/repositories/voice-track.repository";

describe("VoiceTrackRepository Production Rollback Integration Tests (Test A)", () => {
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

  it("proves complete aggregate rollback when a natural DB constraint collision occurs during production replaceTrack", async () => {
    const script = "Original narration script for rollback test.";
    const scriptHash = crypto.createHash("sha256").update(script).digest("hex").toLowerCase();

    const project = await projectRepo.create({
      name: "Rollback Test Project",
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
        summary: "Rollback summary",
        creativeDirection: "Rollback direction",
      },
      []
    );

    // 1. Seed an initial valid VoiceTrack + Boundaries in production database
    const initialTrack = await voiceTrackRepo.replaceTrack({
      projectId: project.id,
      directorPlanId: plan.id,
      sourceScriptHash: scriptHash,
      provider: "azure-speech",
      voiceName: "ur-PK-AsadNeural",
      locale: "ur-PK",
      outputFormat: "Riff24Khz16BitMonoPcm",
      audioSha256: "initial_valid_audio_sha256_1111111111111111111111111111111111111111",
      audioByteCount: 50000,
      audioStorageRef: `projects/${project.id}/audio/initial_valid.wav`,
      durationMs: 3000,
      boundaries: [
        {
          order: 1,
          sourceStart: 0,
          sourceEnd: 8,
          audioStartMs: 100,
          audioDurationMs: 300,
          text: "Original",
        },
        {
          order: 2,
          sourceStart: 9,
          sourceEnd: 18,
          audioStartMs: 500,
          audioDurationMs: 400,
          text: "narration",
        },
      ],
    });

    const initialBoundaryIds = initialTrack.boundaries.map((b) => b.id);
    expect(initialBoundaryIds).toHaveLength(2);

    // 2. Invoke production replaceTrack with duplicate order: 1 values to trigger natural DB UNIQUE constraint failure
    const invalidDuplicateOrderBoundaries = [
      {
        order: 1,
        sourceStart: 0,
        sourceEnd: 4,
        audioStartMs: 100,
        audioDurationMs: 200,
        text: "New1",
      },
      {
        order: 1, // DUPLICATE ORDER -> natural SQLite UNIQUE(voiceTrackId, order) constraint collision
        sourceStart: 5,
        sourceEnd: 9,
        audioStartMs: 350,
        audioDurationMs: 200,
        text: "New2",
      },
    ];

    await expect(
      voiceTrackRepo.replaceTrack({
        projectId: project.id,
        directorPlanId: plan.id,
        sourceScriptHash: scriptHash,
        provider: "azure-speech",
        voiceName: "ur-PK-UzmaNeural",
        locale: "ur-PK",
        outputFormat: "Riff24Khz16BitMonoPcm",
        audioSha256: "corrupted_attempt_sha256_2222222222222222222222222222222222222222",
        audioByteCount: 99999,
        audioStorageRef: `projects/${project.id}/audio/corrupted.wav`,
        durationMs: 8000,
        boundaries: invalidDuplicateOrderBoundaries,
      })
    ).rejects.toThrow();

    // 3. Re-read the database and verify 100% atomic rollback
    const survivingTrack = await voiceTrackRepo.getCurrentForProject(project.id);
    expect(survivingTrack).not.toBeNull();
    expect(survivingTrack!.voiceName).toBe("ur-PK-AsadNeural"); // Rolled back (not UzmaNeural)
    expect(survivingTrack!.audioSha256).toBe("initial_valid_audio_sha256_1111111111111111111111111111111111111111");
    expect(survivingTrack!.durationMs).toBe(3000);
    expect(survivingTrack!.boundaries).toHaveLength(2);
    expect(survivingTrack!.boundaries.map((b) => b.id)).toEqual(initialBoundaryIds);
  });
});
