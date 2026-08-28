import { describe, it, expect, vi } from "vitest";
import { TranscriptionService } from "@/services/transcription.service";
import type { TranscriptionResult } from "@/domain/transcription";
import { NotFoundError, ValidationError } from "@/domain/errors";

describe("TranscriptionService Unit & Integration Tests (TASK-004B)", () => {
  const dummyWav = Buffer.alloc(44 + 32000);
  dummyWav.write("RIFF", 0);
  dummyWav.writeUInt32LE(36 + 32000, 4);
  dummyWav.write("WAVE", 8);
  dummyWav.write("fmt ", 12);
  dummyWav.writeUInt32LE(16, 16);
  dummyWav.writeUInt16LE(1, 20); // PCM
  dummyWav.writeUInt16LE(1, 22); // 1 channel
  dummyWav.writeUInt32LE(16000, 24); // 16kHz
  dummyWav.writeUInt32LE(32000, 28);
  dummyWav.writeUInt16LE(2, 32);
  dummyWav.writeUInt16LE(16, 34);
  dummyWav.write("data", 36);
  dummyWav.writeUInt32LE(32000, 40);

  const sampleResult: TranscriptionResult = {
    provider: "gemini-transcribe",
    model: "gemini-3.5-transcribe",
    requestedMode: "AUTO",
    displayText: "Yeh ek zabardast test phrase hai",
    canonicalText: "Yeh ek zabardast test phrase hai",
    durationMs: 2500,
    wordCount: 6,
    words: [
      { sequence: 1, text: "Yeh", startMs: 0, endMs: 300, sourceStart: 0, sourceEnd: 3 },
      { sequence: 2, text: "ek", startMs: 310, endMs: 500, sourceStart: 4, sourceEnd: 6 },
      { sequence: 3, text: "zabardast", startMs: 510, endMs: 1100, sourceStart: 7, sourceEnd: 16 },
      { sequence: 4, text: "test", startMs: 1110, endMs: 1500, sourceStart: 17, sourceEnd: 21 },
      { sequence: 5, text: "phrase", startMs: 1510, endMs: 2000, sourceStart: 22, sourceEnd: 28 },
      { sequence: 6, text: "hai", startMs: 2010, endMs: 2500, sourceStart: 29, sourceEnd: 32 },
    ],
  };

  it("1. uploads audio source and creates content-addressed AudioSource record after successful preflight probe", async () => {
    const projectRepoMock: any = {
      findById: vi.fn().mockResolvedValue({ id: "proj-123", name: "Test Project" }),
    };
    const audioSourceRepoMock: any = {
      create: vi.fn().mockImplementation((data) => ({
        id: "as-1",
        ...data,
        createdAt: new Date(),
      })),
    };
    const storageMock: any = {
      stageAndPublishAudioSource: vi.fn().mockResolvedValue({
        storageRef: "projects/proj-123/source/hash.wav",
        sourceHash: "a1b2c3d4e5f6",
        sizeBytes: dummyWav.length,
        newlyCreated: true,
      }),
      resolveAbsolutePath: vi.fn().mockReturnValue("I:/AIVA/storage/projects/proj-123/source/hash.wav"),
    };
    const loggerMock: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new TranscriptionService({
      projectRepository: projectRepoMock,
      audioSourceRepository: audioSourceRepoMock,
      transcriptionRepository: {} as any,
      audioSourceStorageService: storageMock,
      transcriptionProvider: {} as any,
      directorService: {} as any,
      logger: loggerMock,
    });

    const result = await service.uploadAudioSource(
      "proj-123",
      dummyWav,
      "audio/wav",
      "voiceover.wav"
    );

    expect(projectRepoMock.findById).toHaveBeenCalledWith("proj-123");
    expect(storageMock.stageAndPublishAudioSource).toHaveBeenCalledTimes(1);
    expect(audioSourceRepoMock.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("as-1");
    expect(result.originalDisplayName).toBe("voiceover.wav");
  });

  it("2. cost-safe reuse: identical audio hash + AUTO mode within same AudioSource returns existing accepted transcription with 0 provider calls", async () => {
    const projectRepoMock: any = {
      findById: vi.fn().mockResolvedValue({ id: "proj-123", name: "Test Project" }),
    };
    const audioSourceRepoMock: any = {
      findById: vi.fn().mockResolvedValue({
        id: "as-1",
        projectId: "proj-123",
        storageRef: "projects/proj-123/source/hash.wav",
        sourceHash: "abc123hash",
        mimeType: "audio/wav",
        activeTranscriptionId: "t-existing-1",
      }),
      setActiveTranscription: vi.fn(),
    };
    const existingRecord = {
      id: "t-existing-1",
      projectId: "proj-123",
      audioSourceId: "as-1",
      provider: "gemini-transcribe",
      model: "gemini-3.5-transcribe",
      requestedMode: "AUTO",
      displayText: "Cached transcript",
      canonicalText: "Cached transcript",
      durationMs: 2500,
      wordCount: 2,
      sourceAudioHash: "abc123hash",
      configurationHash: "expected_conf_hash",
      createdAt: new Date(),
    };
    const transcriptionRepoMock: any = {
      findByAudioSourceAndConfigurationHash: vi.fn().mockResolvedValue(existingRecord),
      createTranscriptionWithWords: vi.fn(),
    };
    const providerMock: any = {
      transcribe: vi.fn(),
    };
    const loggerMock: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new TranscriptionService({
      projectRepository: projectRepoMock,
      audioSourceRepository: audioSourceRepoMock,
      transcriptionRepository: transcriptionRepoMock,
      audioSourceStorageService: {} as any,
      transcriptionProvider: providerMock,
      directorService: {} as any,
      logger: loggerMock,
    });

    const result = await service.transcribeAudio("proj-123", {
      audioSourceId: "as-1",
      mode: "AUTO",
      force: false,
    });

    expect(result.id).toBe("t-existing-1");
    expect(transcriptionRepoMock.findByAudioSourceAndConfigurationHash).toHaveBeenCalledTimes(1);
    expect(providerMock.transcribe).not.toHaveBeenCalled();
  });

  it("3. AudioSource-scoped ownership: A2 never receives A1's Transcription row", async () => {
    const projectRepoMock: any = {
      findById: vi.fn().mockResolvedValue({ id: "proj-123", name: "Test Project" }),
    };
    const audioSourceRepoMock: any = {
      findById: vi.fn().mockResolvedValue({
        id: "as-2",
        projectId: "proj-123",
        storageRef: "projects/proj-123/source/hash.wav",
        sourceHash: "abc123hash",
        mimeType: "audio/wav",
        durationMs: 1000,
        activeTranscriptionId: null,
      }),
      setActiveTranscription: vi.fn(),
    };
    const storageMock: any = {
      audioSourceExists: vi.fn().mockResolvedValue(true),
      readAudioSourceBuffer: vi.fn().mockResolvedValue(dummyWav),
      resolveAbsolutePath: vi.fn().mockReturnValue("dummy.wav"),
    };
    const transcriptionRepoMock: any = {
      // AudioSource as-2 has no transcription for this configuration hash
      findByAudioSourceAndConfigurationHash: vi.fn().mockResolvedValue(null),
      createTranscriptionWithWords: vi.fn().mockImplementation((data) => ({
        id: "t-new-for-as2",
        ...data,
        createdAt: new Date(),
      })),
    };
    const providerMock: any = {
      transcribe: vi.fn().mockResolvedValue(sampleResult),
    };
    const loggerMock: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new TranscriptionService({
      projectRepository: projectRepoMock,
      audioSourceRepository: audioSourceRepoMock,
      transcriptionRepository: transcriptionRepoMock,
      audioSourceStorageService: storageMock,
      transcriptionProvider: providerMock,
      directorService: {} as any,
      logger: loggerMock,
    });

    const result = await service.transcribeAudio("proj-123", {
      audioSourceId: "as-2",
      mode: "AUTO",
      force: false,
    });

    expect(result.id).toBe("t-new-for-as2");
    expect(transcriptionRepoMock.createTranscriptionWithWords).toHaveBeenCalledTimes(1);
    expect(providerMock.transcribe).toHaveBeenCalledTimes(1);
  });

  it("4. changing runtime semantic model invalidates reuse and calls provider", async () => {
    const projectRepoMock: any = {
      findById: vi.fn().mockResolvedValue({ id: "proj-123", name: "Test Project" }),
    };
    const audioSourceRepoMock: any = {
      findById: vi.fn().mockResolvedValue({
        id: "as-1",
        projectId: "proj-123",
        storageRef: "projects/proj-123/source/hash.wav",
        sourceHash: "abc123hash",
        mimeType: "audio/wav",
        durationMs: 1000,
        activeTranscriptionId: "t-existing-1",
      }),
      setActiveTranscription: vi.fn(),
    };
    const storageMock: any = {
      audioSourceExists: vi.fn().mockResolvedValue(true),
      readAudioSourceBuffer: vi.fn().mockResolvedValue(dummyWav),
      resolveAbsolutePath: vi.fn().mockReturnValue("dummy.wav"),
    };
    const transcriptionRepoMock: any = {
      findByAudioSourceAndConfigurationHash: vi.fn().mockResolvedValue(null),
      createTranscriptionWithWords: vi.fn().mockImplementation((data) => ({
        id: "t-new-model",
        ...data,
        createdAt: new Date(),
      })),
    };
    const providerMock: any = {
      transcribe: vi.fn().mockResolvedValue(sampleResult),
    };
    const loggerMock: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new TranscriptionService({
      projectRepository: projectRepoMock,
      audioSourceRepository: audioSourceRepoMock,
      transcriptionRepository: transcriptionRepoMock,
      audioSourceStorageService: storageMock,
      transcriptionProvider: providerMock,
      directorService: {} as any,
      logger: loggerMock,
      runtimeSemantics: {
        geminiModel: "gemini-3.5-custom", // Changed model
      },
    });

    const result = await service.transcribeAudio("proj-123", {
      audioSourceId: "as-1",
      mode: "AUTO",
      force: false,
    });

    expect(result.id).toBe("t-new-model");
    expect(providerMock.transcribe).toHaveBeenCalledTimes(1);
  });

  it("5. useWithDirector feeds canonicalText and sets durable source provenance on DirectorPlan", async () => {
    const projectRepoMock: any = {
      findById: vi.fn().mockResolvedValue({ id: "proj-123" }),
    };
    const transcriptionRepoMock: any = {
      findById: vi.fn().mockResolvedValue({
        id: "t-1",
        projectId: "proj-123",
        canonicalText: "Yeh ek zabardast test phrase hai",
        sourceAudioHash: "audio_hash_999",
        wordCount: 6,
      }),
    };
    const directorServiceMock: any = {
      analyzeAndPlan: vi.fn().mockResolvedValue({
        id: "dp-1",
        projectId: "proj-123",
        originalScript: "Yeh ek zabardast test phrase hai",
        sourceType: "AUDIO_TRANSCRIPT",
        sourceTranscriptionId: "t-1",
        sourceAudioHash: "audio_hash_999",
      }),
    };
    const loggerMock: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new TranscriptionService({
      projectRepository: projectRepoMock,
      audioSourceRepository: {} as any,
      transcriptionRepository: transcriptionRepoMock,
      audioSourceStorageService: {} as any,
      transcriptionProvider: {} as any,
      directorService: directorServiceMock,
      logger: loggerMock,
    });

    const plan = await service.useWithDirector("proj-123", "t-1", {
      brandId: "b-1",
      productId: "p-1",
    });

    expect(directorServiceMock.analyzeAndPlan).toHaveBeenCalledWith("proj-123", {
      script: "Yeh ek zabardast test phrase hai",
      brandId: "b-1",
      productId: "p-1",
      sourceType: "AUDIO_TRANSCRIPT",
      sourceTranscriptionId: "t-1",
      sourceAudioHash: "audio_hash_999",
    });
    expect(plan.sourceType).toBe("AUDIO_TRANSCRIPT");
    expect(plan.sourceTranscriptionId).toBe("t-1");
  });

  it("6. rejects audio exceeding 30-minute preflight bound before provider dispatch with 0 provider calls", async () => {
    const projectRepoMock: any = {
      findById: vi.fn().mockResolvedValue({ id: "proj-123", name: "Test Project" }),
    };
    const audioSourceRepoMock: any = {
      findById: vi.fn().mockResolvedValue({
        id: "as-long",
        projectId: "proj-123",
        storageRef: "projects/proj-123/source/long.wav",
        sourceHash: "longaudiohash",
        mimeType: "audio/wav",
        durationMs: 1800001, // 30 minutes + 1 ms
      }),
    };
    const storageMock: any = {
      audioSourceExists: vi.fn().mockResolvedValue(true),
      readAudioSourceBuffer: vi.fn().mockResolvedValue(Buffer.alloc(100)),
      resolveAbsolutePath: vi.fn().mockReturnValue("I:/AIVA/storage/projects/proj-123/source/long.wav"),
    };
    const providerMock: any = {
      transcribe: vi.fn(),
    };
    const loggerMock: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const service = new TranscriptionService({
      projectRepository: projectRepoMock,
      audioSourceRepository: audioSourceRepoMock,
      transcriptionRepository: {
        findByAudioSourceAndConfigurationHash: vi.fn().mockResolvedValue(null),
      } as any,
      audioSourceStorageService: storageMock,
      transcriptionProvider: providerMock,
      directorService: {} as any,
      logger: loggerMock,
    });

    await expect(
      service.transcribeAudio("proj-123", {
        audioSourceId: "as-long",
        mode: "AUTO",
        force: false,
      })
    ).rejects.toThrow(ValidationError);

    expect(providerMock.transcribe).not.toHaveBeenCalled();
  });
});
