import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { VoiceService } from "@/services/voice.service";
import { FakeVoiceProvider } from "../../mocks/fake-voice.provider";
import { DomainError, ProviderError } from "@/domain/errors";
import { VoiceTrackAggregate, VoiceSynthesisResult, VOICE_OUTPUT_FORMAT } from "@/domain/voice";
import { ProjectRepository, DirectorPlanRepository } from "@/repositories";
import { VoiceTrackRepository, ReplaceVoiceTrackParams } from "@/repositories/voice-track.repository";
import { VoiceStorageService } from "@/storage/voice-storage.service";

describe("Voice Provider Selection & Credit-Safe Reuse Tests", () => {
  const projectId = "proj_test_multi_prov";
  const directorPlanId = "dp_test_multi_prov";
  const script = "Yeh video bohot zabardast banegi AIVA ke sath.";
  const scriptHash = crypto.createHash("sha256").update(script).digest("hex").toLowerCase();

  let inMemoryTrack: VoiceTrackAggregate | null = null;
  let azureSynthesizeCalled = 0;
  let elevenLabsSynthesizeCalled = 0;

  // Mock repositories and storage
  const mockProjectRepo: Partial<ProjectRepository> = {
    findById: async (id: string) => {
      if (id === projectId) {
        return {
          id: projectId,
          name: "Multi-Provider Test Project",
          script,
          status: "DRAFT",
          aspectRatio: "9:16",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      return null;
    },
  };

  const mockDirectorPlanRepo: Partial<DirectorPlanRepository> = {
    findByProjectId: async (pId: string) => {
      if (pId === projectId) {
        return {
          id: directorPlanId,
          projectId: pId,
          originalScript: script,
          scriptHash,
          unitizerVersion: "unitizer-v1",
          schemaVersion: "director-v1",
          promptVersion: "director-v1",
          model: "gemini-3.7-flash",
          language: "ROMAN_URDU",
          contentType: "ADVERTISEMENT",
          summary: "Summary",
          creativeDirection: "Direction",
          brandId: null,
          productId: null,
          generatedAt: new Date(),
          scenes: [],
        };
      }
      return null;
    },
  };

  const mockVoiceTrackRepo: Partial<VoiceTrackRepository> = {
    getCurrentForProject: async (pId: string) => {
      if (pId === projectId) return inMemoryTrack;
      return null;
    },
    isAudioStorageReferenced: async () => true,
    replaceTrack: async (params: ReplaceVoiceTrackParams) => {
      inMemoryTrack = {
        id: "vt_persisted_123",
        projectId: params.projectId,
        directorPlanId: params.directorPlanId,
        sourceScriptHash: params.sourceScriptHash,
        provider: params.provider,
        model: params.model || "azure-neural",
        voiceName: params.voiceName,
        locale: params.locale,
        outputFormat: params.outputFormat,
        audioSha256: params.audioSha256,
        audioByteCount: params.audioByteCount,
        audioStorageRef: params.audioStorageRef,
        durationMs: params.durationMs,
        generatedAt: new Date(),
        boundaries: params.boundaries.map((b, i) => ({
          id: `vb_${i + 1}`,
          voiceTrackId: "vt_persisted_123",
          order: b.order,
          sourceStart: b.sourceStart,
          sourceEnd: b.sourceEnd,
          audioStartMs: b.audioStartMs,
          audioDurationMs: b.audioDurationMs,
        })),
      };
      return inMemoryTrack;
    },
  };

  const mockStorageService: Partial<VoiceStorageService> = {
    audioFileExists: async () => true,
    stageAndPublishAudio: async (audioBuffer) => ({
      storageRef: `projects/${projectId}/audio/test.wav`,
      audioSha256: crypto.createHash("sha256").update(audioBuffer).digest("hex"),
      audioByteCount: audioBuffer.length,
      newlyCreated: true,
    }),
  };

  let fakeAzureProvider: FakeVoiceProvider;
  let fakeElevenLabsProvider: FakeVoiceProvider;
  let voiceService: VoiceService;

  beforeEach(() => {
    inMemoryTrack = null;
    azureSynthesizeCalled = 0;
    elevenLabsSynthesizeCalled = 0;

    fakeAzureProvider = new FakeVoiceProvider({
      id: "azure-speech",
      isConfigured: true,
      defaultVoice: "ur-PK-AsadNeural",
      defaultModel: "azure-neural",
      onSynthesize: () => {
        azureSynthesizeCalled++;
      },
    });

    fakeElevenLabsProvider = new FakeVoiceProvider({
      id: "elevenlabs",
      isConfigured: true,
      defaultVoice: "",
      defaultModel: "eleven_v3",
      onSynthesize: () => {
        elevenLabsSynthesizeCalled++;
      },
    });

    voiceService = new VoiceService({
      projectRepository: mockProjectRepo as ProjectRepository,
      directorPlanRepository: mockDirectorPlanRepo as DirectorPlanRepository,
      voiceTrackRepository: mockVoiceTrackRepo as VoiceTrackRepository,
      voiceProviders: {
        "azure-speech": fakeAzureProvider,
        azure: fakeAzureProvider,
        elevenlabs: fakeElevenLabsProvider,
      },
      voiceStorageService: mockStorageService as VoiceStorageService,
    });
  });

  it("defaults to Azure when provider is omitted (backward compatibility)", async () => {
    const track = await voiceService.generateVoice(projectId, {
      voiceName: "ur-PK-AsadNeural",
    });

    expect(azureSynthesizeCalled).toBe(1);
    expect(elevenLabsSynthesizeCalled).toBe(0);
    expect(track.provider).toBe("azure-speech");
    expect(track.model).toBe("azure-neural");
  });

  it("calls only Azure when provider is explicitly AZURE", async () => {
    const track = await voiceService.generateVoice(projectId, {
      provider: "AZURE",
      voiceName: "ur-PK-UzmaNeural",
    });

    expect(azureSynthesizeCalled).toBe(1);
    expect(elevenLabsSynthesizeCalled).toBe(0);
    expect(track.provider).toBe("azure-speech");
    expect(track.voiceName).toBe("ur-PK-UzmaNeural");
    expect(track.model).toBe("azure-neural");
  });

  it("calls only ElevenLabs when provider is explicitly ELEVENLABS", async () => {
    const track = await voiceService.generateVoice(projectId, {
      provider: "ELEVENLABS",
      voiceName: "voice_el_sample_1",
    });

    expect(azureSynthesizeCalled).toBe(0);
    expect(elevenLabsSynthesizeCalled).toBe(1);
    expect(track.provider).toBe("elevenlabs");
    expect(track.voiceName).toBe("voice_el_sample_1");
    expect(track.model).toBe("eleven_v3");
  });

  it("fails closed before synthesis when ElevenLabs voice is missing and unconfigured", async () => {
    const customElevenLabs = new FakeVoiceProvider({
      isConfigured: true,
      defaultVoice: "",
    });
    Object.defineProperty(customElevenLabs, "id", { value: "elevenlabs" });

    const testService = new VoiceService({
      projectRepository: mockProjectRepo as ProjectRepository,
      directorPlanRepository: mockDirectorPlanRepo as DirectorPlanRepository,
      voiceTrackRepository: mockVoiceTrackRepo as VoiceTrackRepository,
      voiceProviders: {
        "azure-speech": fakeAzureProvider,
        elevenlabs: customElevenLabs,
      },
      voiceStorageService: mockStorageService as VoiceStorageService,
    });

    await expect(
      testService.generateVoice(projectId, { provider: "ELEVENLABS" })
    ).rejects.toThrow(DomainError);

    expect(azureSynthesizeCalled).toBe(0);
    expect(elevenLabsSynthesizeCalled).toBe(0);
  });

  it("proves zero automatic cross-provider fallback when Azure fails", async () => {
    const failingAzure = new FakeVoiceProvider({
      isConfigured: true,
      errorToThrow: new ProviderError("azure-speech", "Azure rate limit", { code: "RATE_LIMITED" }),
    });
    Object.defineProperty(failingAzure, "id", { value: "azure-speech" });

    const testService = new VoiceService({
      projectRepository: mockProjectRepo as ProjectRepository,
      directorPlanRepository: mockDirectorPlanRepo as DirectorPlanRepository,
      voiceTrackRepository: mockVoiceTrackRepo as VoiceTrackRepository,
      voiceProviders: {
        "azure-speech": failingAzure,
        elevenlabs: fakeElevenLabsProvider,
      },
      voiceStorageService: mockStorageService as VoiceStorageService,
    });

    await expect(
      testService.generateVoice(projectId, { provider: "AZURE", voiceName: "ur-PK-AsadNeural" })
    ).rejects.toThrow(ProviderError);

    // ElevenLabs must NOT have been called
    expect(elevenLabsSynthesizeCalled).toBe(0);
  });

  it("proves zero automatic cross-provider fallback when ElevenLabs fails", async () => {
    const failingElevenLabs = new FakeVoiceProvider({
      isConfigured: true,
      errorToThrow: new ProviderError("elevenlabs", "ElevenLabs quota exceeded", { code: "RATE_LIMITED" }),
    });
    Object.defineProperty(failingElevenLabs, "id", { value: "elevenlabs" });

    const testService = new VoiceService({
      projectRepository: mockProjectRepo as ProjectRepository,
      directorPlanRepository: mockDirectorPlanRepo as DirectorPlanRepository,
      voiceTrackRepository: mockVoiceTrackRepo as VoiceTrackRepository,
      voiceProviders: {
        "azure-speech": fakeAzureProvider,
        elevenlabs: failingElevenLabs,
      },
      voiceStorageService: mockStorageService as VoiceStorageService,
    });

    await expect(
      testService.generateVoice(projectId, { provider: "ELEVENLABS", voiceName: "voice_el_sample_1" })
    ).rejects.toThrow(ProviderError);

    // Azure must NOT have been called
    expect(azureSynthesizeCalled).toBe(0);
  });

  it("rejects unsupported provider names immediately with INVALID_PROVIDER", async () => {
    await expect(
      voiceService.generateVoice(projectId, { provider: "AMAZON_POLLY" as never })
    ).rejects.toThrow(DomainError);

    expect(azureSynthesizeCalled).toBe(0);
    expect(elevenLabsSynthesizeCalled).toBe(0);
  });

  it("fails safely when ElevenLabs is unconfigured without impacting Azure", async () => {
    const unconfiguredElevenLabs = new FakeVoiceProvider({
      isConfigured: false,
    });
    Object.defineProperty(unconfiguredElevenLabs, "id", { value: "elevenlabs" });

    const testService = new VoiceService({
      projectRepository: mockProjectRepo as ProjectRepository,
      directorPlanRepository: mockDirectorPlanRepo as DirectorPlanRepository,
      voiceTrackRepository: mockVoiceTrackRepo as VoiceTrackRepository,
      voiceProviders: {
        "azure-speech": fakeAzureProvider,
        elevenlabs: unconfiguredElevenLabs,
      },
      voiceStorageService: mockStorageService as VoiceStorageService,
    });

    // Azure continues to work
    const azureTrack = await testService.generateVoice(projectId, {
      provider: "AZURE",
      voiceName: "ur-PK-AsadNeural",
    });
    expect(azureTrack.provider).toBe("azure-speech");

    // ElevenLabs request fails with VOICE_UNCONFIGURED
    try {
      await testService.generateVoice(projectId, { provider: "ELEVENLABS" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("VOICE_UNCONFIGURED");
    }
  });

  describe("Composite Credit-Safe Reuse Identity", () => {
    it("reuses existing track when script + provider + voice + model all match", async () => {
      // 1. Generate initial track
      await voiceService.generateVoice(projectId, {
        provider: "ELEVENLABS",
        voiceName: "voice_A",
      });
      expect(elevenLabsSynthesizeCalled).toBe(1);

      // 2. Call again with identical parameters
      const reused = await voiceService.generateVoice(projectId, {
        provider: "ELEVENLABS",
        voiceName: "voice_A",
      });

      // Must be a reuse hit (synthesize not called second time)
      expect(elevenLabsSynthesizeCalled).toBe(1);
      expect(reused.provider).toBe("elevenlabs");
      expect(reused.voiceName).toBe("voice_A");
    });

    it("does NOT collide or reuse when provider differs", async () => {
      // 1. Generate Azure track
      await voiceService.generateVoice(projectId, {
        provider: "AZURE",
        voiceName: "ur-PK-AsadNeural",
      });
      expect(azureSynthesizeCalled).toBe(1);

      // 2. Generate ElevenLabs track on same project & script
      await voiceService.generateVoice(projectId, {
        provider: "ELEVENLABS",
        voiceName: "voice_A",
      });

      // Both providers must have executed their own synthesis
      expect(azureSynthesizeCalled).toBe(1);
      expect(elevenLabsSynthesizeCalled).toBe(1);
    });

    it("does NOT collide or reuse when voice differs on same provider", async () => {
      // 1. Generate with Voice A
      await voiceService.generateVoice(projectId, {
        provider: "ELEVENLABS",
        voiceName: "voice_A",
      });
      expect(elevenLabsSynthesizeCalled).toBe(1);

      // 2. Generate with Voice B
      await voiceService.generateVoice(projectId, {
        provider: "ELEVENLABS",
        voiceName: "voice_B",
      });

      // Second voice must synthesize freshly
      expect(elevenLabsSynthesizeCalled).toBe(2);
    });
  });
});
