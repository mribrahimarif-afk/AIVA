import { describe, it, expect, vi } from "vitest";
import { VoiceService } from "@/services/voice.service";
import { DomainError } from "@/domain/errors";
import { FakeVoiceProvider } from "../../mocks/fake-voice.provider";
import crypto from "node:crypto";

describe("VoiceService — Stale Audio-First Plan Rejection & Script-First Non-Regression", () => {
  const dummyScript = "This is a valid test narration script.";
  const validScriptHash = crypto.createHash("sha256").update(dummyScript).digest("hex").toLowerCase();

  const dummyProject = {
    id: "proj-1",
    name: "Project 1",
    brandId: null,
    productId: null,
    script: dummyScript,
    status: "DRAFT",
    aspectRatio: "9:16",
    resolution: "1080p",
    targetDuration: 30,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const projectRepo = {
    findById: vi.fn(async () => dummyProject),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };

  const voiceTrackRepo = {
    create: vi.fn(),
    getCurrentForProject: vi.fn(async () => null),
    replaceTrack: vi.fn(async (data: any) => ({
      id: "vt-1",
      projectId: data.projectId,
      directorPlanId: data.directorPlanId,
      sourceScriptHash: data.sourceScriptHash,
      provider: data.provider,
      model: data.model,
      voiceName: data.voiceName,
      locale: data.locale,
      outputFormat: data.outputFormat,
      audioSha256: data.audioSha256,
      audioByteCount: data.audioByteCount,
      audioStorageRef: data.audioStorageRef,
      durationMs: data.durationMs,
      createdAt: new Date(),
      updatedAt: new Date(),
      generatedAt: new Date(),
      boundaries: data.boundaries || [],
    })),
    deleteCurrentForProject: vi.fn(),
  };

  const fakeVoiceProvider = new FakeVoiceProvider({
    id: "azure-speech",
    defaultVoice: "ur-PK-AsadNeural",
  });

  const mockVoiceStorage = {
    stageAndPublishAudio: vi.fn(async () => ({
      storageRef: "projects/proj-1/voice/audio.wav",
      audioSha256: "checksum-1",
      audioByteCount: 1024,
    })),
    audioFileExists: vi.fn(async () => true),
  };

  it("rejects voice generation when Audio-First Director plan is based on a stale transcription (0 provider calls, 0 DB rows, 0 storage writes)", async () => {
    const synthesizeSpy = vi.spyOn(fakeVoiceProvider, "synthesize");
    voiceTrackRepo.replaceTrack.mockClear();
    mockVoiceStorage.stageAndPublishAudio.mockClear();

    // Stale plan references T1, but active transcription on AudioSource A1 has changed to T2
    const stalePlan = {
      id: "plan-1",
      projectId: "proj-1",
      originalScript: dummyScript,
      scriptHash: validScriptHash,
      unitizerVersion: "v1",
      schemaVersion: "v1",
      promptVersion: "v1",
      model: "test-model",
      language: "en",
      contentType: "PROMOTIONAL",
      summary: "Summary",
      creativeDirection: "Direction",
      brandId: null,
      productId: null,
      sourceType: "AUDIO_TRANSCRIPT" as const,
      sourceTranscriptionId: "T1",
      sourceAudioHash: "hash-1",
      generatedAt: new Date(),
      scenes: [],
    };

    const planRepo = {
      findByProjectId: vi.fn(async () => stalePlan),
      replacePlan: vi.fn(),
      deleteByProjectId: vi.fn(),
    };

    const transcriptionRepo = {
      create: vi.fn(),
      findById: vi.fn(async (id: string) => {
        if (id === "T1") {
          return {
            id: "T1",
            projectId: "proj-1",
            audioSourceId: "A1",
            sourceAudioHash: "hash-1",
            canonicalText: dummyScript,
            wordCount: 7,
          };
        }
        return null;
      }),
      findByAudioSourceId: vi.fn(),
      findByAudioSourceAndConfigurationHash: vi.fn(),
      delete: vi.fn(),
    };

    const audioSourceRepo = {
      create: vi.fn(),
      findById: vi.fn(async () => ({
        id: "A1",
        projectId: "proj-1",
        activeTranscriptionId: "T2", // Active is now T2, making T1 stale!
      })),
      findByProjectId: vi.fn(async () => []),
      setActiveTranscription: vi.fn(),
      delete: vi.fn(),
    };

    const voiceService = new VoiceService({
      projectRepository: projectRepo as any,
      directorPlanRepository: planRepo as any,
      voiceTrackRepository: voiceTrackRepo as any,
      audioSourceRepository: audioSourceRepo as any,
      transcriptionRepository: transcriptionRepo as any,
      voiceProvider: fakeVoiceProvider as any,
      voiceStorageService: mockVoiceStorage as any,
    });

    await expect(
      voiceService.generateVoice("proj-1", { provider: "AZURE" })
    ).rejects.toThrow(DomainError);

    // Strict behavioral evidence: 0 provider calls, 0 track creations, 0 storage publications
    expect(synthesizeSpy).not.toHaveBeenCalled();
    expect(voiceTrackRepo.replaceTrack).not.toHaveBeenCalled();
    expect(mockVoiceStorage.stageAndPublishAudio).not.toHaveBeenCalled();
  });

  it("permits voice generation when Audio-First Director plan is current", async () => {
    const currentPlan = {
      id: "plan-current",
      projectId: "proj-1",
      originalScript: dummyScript,
      scriptHash: validScriptHash,
      unitizerVersion: "v1",
      schemaVersion: "v1",
      promptVersion: "v1",
      model: "test-model",
      language: "en",
      contentType: "PROMOTIONAL",
      summary: "Summary",
      creativeDirection: "Direction",
      brandId: null,
      productId: null,
      sourceType: "AUDIO_TRANSCRIPT" as const,
      sourceTranscriptionId: "T-current",
      sourceAudioHash: "hash-current",
      generatedAt: new Date(),
      scenes: [],
    };

    const planRepo = {
      findByProjectId: vi.fn(async () => currentPlan),
      replacePlan: vi.fn(),
      deleteByProjectId: vi.fn(),
    };

    const transcriptionRepo = {
      create: vi.fn(),
      findById: vi.fn(async (id: string) => {
        if (id === "T-current") {
          return {
            id: "T-current",
            projectId: "proj-1",
            audioSourceId: "A1",
            sourceAudioHash: "hash-current",
            canonicalText: dummyScript,
            wordCount: 7,
          };
        }
        return null;
      }),
      findByAudioSourceId: vi.fn(),
      findByAudioSourceAndConfigurationHash: vi.fn(),
      delete: vi.fn(),
    };

    const audioSourceRepo = {
      create: vi.fn(),
      findById: vi.fn(async () => ({
        id: "A1",
        projectId: "proj-1",
        activeTranscriptionId: "T-current", // Matches!
      })),
      findByProjectId: vi.fn(async () => []),
      setActiveTranscription: vi.fn(),
      delete: vi.fn(),
    };

    const voiceService = new VoiceService({
      projectRepository: projectRepo as any,
      directorPlanRepository: planRepo as any,
      voiceTrackRepository: voiceTrackRepo as any,
      audioSourceRepository: audioSourceRepo as any,
      transcriptionRepository: transcriptionRepo as any,
      voiceProvider: fakeVoiceProvider as any,
      voiceStorageService: mockVoiceStorage as any,
    });

    const track = await voiceService.generateVoice("proj-1", { provider: "AZURE" });
    expect(track).toBeDefined();
    expect(track.sourceScriptHash).toBe(validScriptHash);
  });

  it("permits voice generation for standard Script-First Director plans without requiring transcription provenance", async () => {
    const scriptFirstPlan = {
      id: "plan-script-first",
      projectId: "proj-1",
      originalScript: dummyScript,
      scriptHash: validScriptHash,
      unitizerVersion: "v1",
      schemaVersion: "v1",
      promptVersion: "v1",
      model: "test-model",
      language: "en",
      contentType: "PROMOTIONAL",
      summary: "Summary",
      creativeDirection: "Direction",
      brandId: null,
      productId: null,
      sourceType: "SCRIPT" as const,
      sourceTranscriptionId: null,
      sourceAudioHash: null,
      generatedAt: new Date(),
      scenes: [],
    };

    const planRepo = {
      findByProjectId: vi.fn(async () => scriptFirstPlan),
      replacePlan: vi.fn(),
      deleteByProjectId: vi.fn(),
    };

    const voiceService = new VoiceService({
      projectRepository: projectRepo as any,
      directorPlanRepository: planRepo as any,
      voiceTrackRepository: voiceTrackRepo as any,
      voiceProvider: fakeVoiceProvider as any,
      voiceStorageService: mockVoiceStorage as any,
    });

    const track = await voiceService.generateVoice("proj-1", { provider: "AZURE" });
    expect(track).toBeDefined();
    expect(track.sourceScriptHash).toBe(validScriptHash);
  });
});
