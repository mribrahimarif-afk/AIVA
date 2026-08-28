import { describe, it, expect, vi } from "vitest";
import { createDirectorService } from "@/services/director.service";
import type {
  DirectorPlanRepository,
  ProjectRepository,
  BrandRepository,
  ProductRepository,
  AudioSourceRepository,
  TranscriptionRepository,
} from "@/repositories";
import type { DirectorAiProvider } from "@/providers/ai";
import { ValidationError } from "@/domain/errors";

describe("Director Audio-First Currentness and Provenance", () => {
  const dummyLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const projectRepo = {
    create: vi.fn(),
    findById: vi.fn(async (id: string) => ({
      id,
      name: "Project 1",
      brandId: null,
      productId: null,
      script: "Initial script",
      status: "DRAFT" as const,
      aspectRatio: "9:16" as const,
      resolution: "1080p" as const,
      targetDuration: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };

  const brandRepo = {
    create: vi.fn(),
    findById: vi.fn(async () => null),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };

  const productRepo = {
    create: vi.fn(),
    findById: vi.fn(async () => null),
    findByBrandId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    addAlias: vi.fn(),
    deleteAlias: vi.fn(),
  };

  it("resolves currentness accurately for multi-AudioSource projects using the owning AudioSource", async () => {
    // Project P contains two audio sources:
    // A1 (active = T1), owning plan P1 (sourceTranscriptionId = T1)
    // A2 (active = T2)
    const transcriptions = new Map<string, any>([
      [
        "T1",
        {
          id: "T1",
          projectId: "P1",
          audioSourceId: "A1",
          sourceAudioHash: "hash-1",
          canonicalText: "Text for source 1",
          wordCount: 4,
        },
      ],
      [
        "T2",
        {
          id: "T2",
          projectId: "P1",
          audioSourceId: "A2",
          sourceAudioHash: "hash-2",
          canonicalText: "Text for source 2",
          wordCount: 4,
        },
      ],
      [
        "T3",
        {
          id: "T3",
          projectId: "P1",
          audioSourceId: "A1",
          sourceAudioHash: "hash-1-new",
          canonicalText: "Text for source 1 new",
          wordCount: 5,
        },
      ],
    ]);

    const audioSources = new Map<string, any>([
      [
        "A1",
        {
          id: "A1",
          projectId: "P1",
          activeTranscriptionId: "T1",
        },
      ],
      [
        "A2",
        {
          id: "A2",
          projectId: "P1",
          activeTranscriptionId: "T2",
        },
      ],
    ]);

    const storedPlan = {
      id: "plan-1",
      projectId: "P1",
      originalScript: "Text for source 1",
      scriptHash: "sha-1",
      unitizerVersion: "v1",
      schemaVersion: "v1",
      promptVersion: "v1",
      model: "test-model",
      language: "ENGLISH" as const,
      contentType: "PROMOTIONAL" as const,
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
      findByProjectId: vi.fn(async () => storedPlan),
      replacePlan: vi.fn(),
    };

    const audioSourceRepo = {
      create: vi.fn(),
      findById: vi.fn(async (id: string) => audioSources.get(id) || null),
      findByProjectId: vi.fn(async () => Array.from(audioSources.values())),
      findBySourceHash: vi.fn(),
      setActiveTranscription: vi.fn(),
      delete: vi.fn(),
    };

    const transcriptionRepo = {
      findById: vi.fn(async (id: string) => transcriptions.get(id) || null),
      findByAudioSourceId: vi.fn(),
      findByAudioSourceAndConfigurationHash: vi.fn(),
      delete: vi.fn(),
    };

    const aiProvider: DirectorAiProvider = {
      id: "test-ai",
      modelName: "test-model",
      isConfigured: () => true,
      analyze: vi.fn(),
      repair: vi.fn(),
    };

    const service = createDirectorService({
      directorPlanRepository: planRepo as unknown as DirectorPlanRepository,
      projectRepository: projectRepo as unknown as ProjectRepository,
      brandRepository: brandRepo as unknown as BrandRepository,
      productRepository: productRepo as unknown as ProductRepository,
      audioSourceRepository: audioSourceRepo as unknown as AudioSourceRepository,
      transcriptionRepository: transcriptionRepo as unknown as TranscriptionRepository,
      directorAiProvider: aiProvider,
      logger: dummyLogger as any,
    });

    // 1. Initial check: A1.activeTranscriptionId is T1, so P1.isCurrent must be true
    const planResult1 = await service.getPlan("P1");
    expect(planResult1?.isCurrent).toBe(true);

    // 2. Now A1 gets a new active transcription T3 (A2 still has T2)
    audioSources.set("A1", {
      id: "A1",
      projectId: "P1",
      activeTranscriptionId: "T3",
    });

    // 3. Check again: P1.isCurrent must now evaluate to false because A1's active is T3, regardless of A2!
    const planResult2 = await service.getPlan("P1");
    expect(planResult2?.isCurrent).toBe(false);
  });

  it("rejects Audio-First Director plan creation when referenced transcription belongs to another project", async () => {
    const transcriptions = new Map<string, any>([
      [
        "T-foreign",
        {
          id: "T-foreign",
          projectId: "P-foreign",
          audioSourceId: "A-foreign",
          sourceAudioHash: "hash-foreign",
          canonicalText: "Foreign transcript text",
          wordCount: 3,
        },
      ],
    ]);

    const planRepo = {
      findByProjectId: vi.fn(async () => null),
      replacePlan: vi.fn(),
    };

    const audioSourceRepo = {
      create: vi.fn(),
      findById: vi.fn(async () => null),
      findByProjectId: vi.fn(async () => []),
      findBySourceHash: vi.fn(),
      setActiveTranscription: vi.fn(),
      delete: vi.fn(),
    };

    const transcriptionRepo = {
      findById: vi.fn(async (id: string) => transcriptions.get(id) || null),
      findByAudioSourceId: vi.fn(),
      findByAudioSourceAndConfigurationHash: vi.fn(),
      delete: vi.fn(),
    };

    const aiProvider: DirectorAiProvider = {
      id: "test-ai",
      modelName: "test-model",
      isConfigured: () => true,
      analyze: vi.fn(),
      repair: vi.fn(),
    };

    const service = createDirectorService({
      directorPlanRepository: planRepo as unknown as DirectorPlanRepository,
      projectRepository: projectRepo as unknown as ProjectRepository,
      brandRepository: brandRepo as unknown as BrandRepository,
      productRepository: productRepo as unknown as ProductRepository,
      audioSourceRepository: audioSourceRepo as unknown as AudioSourceRepository,
      transcriptionRepository: transcriptionRepo as unknown as TranscriptionRepository,
      directorAiProvider: aiProvider,
      logger: dummyLogger as any,
    });

    await expect(
      service.analyzeAndPlan("P1", {
        script: "Foreign transcript text",
        sourceType: "AUDIO_TRANSCRIPT",
        sourceTranscriptionId: "T-foreign",
      })
    ).rejects.toThrow(ValidationError);

    // AI Provider must have received ZERO calls
    expect(aiProvider.analyze).not.toHaveBeenCalled();
  });

  it("rejects Audio-First plan creation when sourceAudioHash does not match referenced transcription", async () => {
    const transcriptions = new Map<string, any>([
      [
        "T-valid",
        {
          id: "T-valid",
          projectId: "P1",
          audioSourceId: "A1",
          sourceAudioHash: "hash-authentic",
          canonicalText: "Authentic text",
          wordCount: 2,
        },
      ],
    ]);

    const audioSources = new Map<string, any>([
      [
        "A1",
        {
          id: "A1",
          projectId: "P1",
          activeTranscriptionId: "T-valid",
        },
      ],
    ]);

    const planRepo = {
      findByProjectId: vi.fn(async () => null),
      replacePlan: vi.fn(),
    };

    const audioSourceRepo = {
      create: vi.fn(),
      findById: vi.fn(async (id: string) => audioSources.get(id) || null),
      findByProjectId: vi.fn(async () => Array.from(audioSources.values())),
      findBySourceHash: vi.fn(),
      setActiveTranscription: vi.fn(),
      delete: vi.fn(),
    };

    const transcriptionRepo = {
      findById: vi.fn(async (id: string) => transcriptions.get(id) || null),
      findByAudioSourceId: vi.fn(),
      findByAudioSourceAndConfigurationHash: vi.fn(),
      delete: vi.fn(),
    };

    const aiProvider: DirectorAiProvider = {
      id: "test-ai",
      modelName: "test-model",
      isConfigured: () => true,
      analyze: vi.fn(),
      repair: vi.fn(),
    };

    const service = createDirectorService({
      directorPlanRepository: planRepo as unknown as DirectorPlanRepository,
      projectRepository: projectRepo as unknown as ProjectRepository,
      brandRepository: brandRepo as unknown as BrandRepository,
      productRepository: productRepo as unknown as ProductRepository,
      audioSourceRepository: audioSourceRepo as unknown as AudioSourceRepository,
      transcriptionRepository: transcriptionRepo as unknown as TranscriptionRepository,
      directorAiProvider: aiProvider,
      logger: dummyLogger as any,
    });

    await expect(
      service.analyzeAndPlan("P1", {
        script: "Authentic text",
        sourceType: "AUDIO_TRANSCRIPT",
        sourceTranscriptionId: "T-valid",
        sourceAudioHash: "mismatched-hash",
      })
    ).rejects.toThrow(ValidationError);

    expect(aiProvider.analyze).not.toHaveBeenCalled();
  });
});
