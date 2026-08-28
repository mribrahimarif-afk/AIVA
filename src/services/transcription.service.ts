import { NotFoundError, ValidationError } from "@/domain/errors";
import {
  validateAudioUpload,
  MAX_AUDIO_DURATION_MS,
  computeTranscriptionConfigHash,
  type AudioSourceInfo,
  type TranscriptionRecord,
  type TranscribeRequestInput,
  type UseWithDirectorInput,
} from "@/domain/transcription";
import type { DirectorPlan } from "@/domain/director";
import type {
  ProjectRepository,
  AudioSourceRepository,
  TranscriptionRepository,
} from "@/repositories";
import type { AudioSourceStorageService } from "@/storage/audio-source-storage.service";
import { probeAudioDurationMs } from "@/storage/audio-normalizer";
import type { TranscriptionProvider } from "@/providers/transcription";
import type { DirectorService } from "./director.service";
import type { Logger } from "@/infrastructure/logging/logger";

export interface TranscriptionServiceOptions {
  projectRepository: ProjectRepository;
  audioSourceRepository: AudioSourceRepository;
  transcriptionRepository: TranscriptionRepository;
  audioSourceStorageService: AudioSourceStorageService;
  transcriptionProvider: TranscriptionProvider;
  directorService: DirectorService;
  logger: Logger;
  maxAudioBytes?: number;
}

export class TranscriptionService {
  private readonly projectRepository: ProjectRepository;
  private readonly audioSourceRepository: AudioSourceRepository;
  private readonly transcriptionRepository: TranscriptionRepository;
  private readonly audioSourceStorageService: AudioSourceStorageService;
  private readonly transcriptionProvider: TranscriptionProvider;
  private readonly directorService: DirectorService;
  private readonly logger: Logger;
  private readonly maxAudioBytes: number;

  constructor(options: TranscriptionServiceOptions) {
    this.projectRepository = options.projectRepository;
    this.audioSourceRepository = options.audioSourceRepository;
    this.transcriptionRepository = options.transcriptionRepository;
    this.audioSourceStorageService = options.audioSourceStorageService;
    this.transcriptionProvider = options.transcriptionProvider;
    this.directorService = options.directorService;
    this.logger = options.logger;
    this.maxAudioBytes = options.maxAudioBytes || 52428800; // 50 MB default
  }

  /**
   * Validates and content-addressed uploads an audio source for a project.
   */
  async uploadAudioSource(
    projectId: string,
    audioBuffer: Buffer,
    declaredMimeType: string,
    originalFilename?: string | null
  ): Promise<AudioSourceInfo> {
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new NotFoundError("Project not found", { projectId });
    }

    // 1. Validate audio format, magic bytes, and size limit
    const validated = validateAudioUpload(
      audioBuffer,
      declaredMimeType,
      originalFilename,
      this.maxAudioBytes
    );

    // 2. Stage and publish content-addressed file
    const publishResult = await this.audioSourceStorageService.stageAndPublishAudioSource(
      audioBuffer,
      projectId,
      validated.extension
    );

    // 3. Preflight probe audio duration
    const absolutePath = this.audioSourceStorageService.resolveAbsolutePath(
      publishResult.storageRef
    );
    const durationMs = await probeAudioDurationMs(audioBuffer, absolutePath);

    if (durationMs !== null && durationMs > MAX_AUDIO_DURATION_MS) {
      throw new ValidationError(
        `Audio duration (${Math.round(durationMs / 1000)}s) exceeds the maximum allowed ceiling of 30 minutes (1800s)`
      );
    }

    // 4. Persist AudioSource record in database
    const audioSource = await this.audioSourceRepository.create({
      projectId,
      storageRef: publishResult.storageRef,
      sourceHash: publishResult.sourceHash,
      mimeType: validated.mimeType,
      sizeBytes: publishResult.sizeBytes,
      durationMs,
      originalDisplayName: validated.safeDisplayName,
    });

    this.logger.info({
      event: "audio_source.uploaded",
      projectId,
      audioSourceId: audioSource.id,
      sourceHash: audioSource.sourceHash.substring(0, 12),
      sizeBytes: audioSource.sizeBytes,
      durationMs: audioSource.durationMs !== null ? audioSource.durationMs : undefined,
      mimeType: audioSource.mimeType,
    });

    return audioSource;
  }

  /**
   * Transcribes an existing AudioSource using resilient provider routing with cost-safe reuse.
   */
  async transcribeAudio(
    projectId: string,
    input: TranscribeRequestInput
  ): Promise<TranscriptionRecord> {
    const { audioSourceId, mode = "AUTO", force = false } = input;

    // 1. Validate Project & AudioSource
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw new NotFoundError("Project not found", { projectId });
    }

    const audioSource = await this.audioSourceRepository.findById(audioSourceId);
    if (!audioSource || audioSource.projectId !== projectId) {
      throw new NotFoundError("AudioSource not found for this project", {
        audioSourceId,
        projectId,
      });
    }

    // 2. Compute deterministic configuration reuse hash
    const requestedMode = mode as "AUTO" | "GEMINI" | "AZURE" | "ELEVENLABS";
    const configurationHash = computeTranscriptionConfigHash({
      sourceAudioHash: audioSource.sourceHash,
      requestedMode,
    });

    // 3. Cost-safe reuse check: if not forcing, return existing accepted record
    if (!force) {
      const existing = await this.transcriptionRepository.findByConfigurationHash(
        projectId,
        configurationHash
      );
      if (existing) {
        // Ensure active transcription pointer is updated to this existing record
        if (audioSource.activeTranscriptionId !== existing.id) {
          await this.audioSourceRepository.setActiveTranscription(
            audioSourceId,
            existing.id
          );
        }

        this.logger.info({
          event: "transcription.reuse_hit",
          projectId,
          audioSourceId,
          transcriptionId: existing.id,
          requestedMode,
          actualProvider: existing.provider,
        });

        return existing;
      }
    }

    // 4. Verify physical audio file exists in storage and read buffer
    const fileExists = await this.audioSourceStorageService.audioSourceExists(
      audioSource.storageRef
    );
    if (!fileExists) {
      throw new NotFoundError("Underlying audio file not found in storage", {
        storageRef: audioSource.storageRef,
      });
    }

    const audioBuffer = await this.audioSourceStorageService.readAudioSourceBuffer(
      audioSource.storageRef
    );
    const sourceFilePath = this.audioSourceStorageService.resolveAbsolutePath(
      audioSource.storageRef
    );

    // 5. Preflight duration check before any provider dispatch
    let probedDurationMs: number | null = audioSource.durationMs ?? null;
    if (probedDurationMs === null) {
      probedDurationMs = await probeAudioDurationMs(audioBuffer, sourceFilePath);
    }
    if (typeof probedDurationMs === "number" && probedDurationMs > MAX_AUDIO_DURATION_MS) {
      throw new ValidationError(
        `Audio duration (${probedDurationMs}ms) exceeds the maximum allowed ceiling of 30 minutes`
      );
    }

    // 6. Execute transcription via provider router
    const result = await this.transcriptionProvider.transcribe({
      audioBuffer,
      mimeType: audioSource.mimeType,
      sourceFilePath,
      durationMs: probedDurationMs !== null ? probedDurationMs : undefined,
      projectId,
      audioSourceId,
      requestedMode: mode,
    });

    // 7. Persist Transcription record and words atomically in DB
    const savedTranscription =
      await this.transcriptionRepository.createTranscriptionWithWords(
        {
          projectId,
          audioSourceId,
          provider: result.provider,
          model: result.model,
          requestedMode: result.requestedMode,
          displayText: result.displayText,
          canonicalText: result.canonicalText,
          detectedLanguage: result.detectedLanguage ?? null,
          durationMs: result.durationMs,
          wordCount: result.wordCount,
          sourceAudioHash: audioSource.sourceHash,
          configurationHash,
        },
        result.words
      );

    this.logger.info({
      event: "transcription.completed",
      projectId,
      audioSourceId,
      transcriptionId: savedTranscription.id,
      provider: savedTranscription.provider,
      model: savedTranscription.model,
      wordCount: savedTranscription.wordCount,
      durationMs: savedTranscription.durationMs,
    });

    return savedTranscription;
  }

  /**
   * Retrieves all audio sources for a project.
   */
  async getAudioSources(projectId: string): Promise<AudioSourceInfo[]> {
    return this.audioSourceRepository.findByProjectId(projectId);
  }

  /**
   * Retrieves a single audio source by ID.
   */
  async getAudioSource(audioSourceId: string): Promise<AudioSourceInfo | null> {
    return this.audioSourceRepository.findById(audioSourceId);
  }

  /**
   * Retrieves all transcriptions for a project.
   */
  async getTranscriptions(projectId: string): Promise<TranscriptionRecord[]> {
    return this.transcriptionRepository.findByProjectId(projectId);
  }

  /**
   * Retrieves a single transcription record with ordered words.
   */
  async getTranscription(transcriptionId: string): Promise<TranscriptionRecord | null> {
    return this.transcriptionRepository.findById(transcriptionId);
  }

  /**
   * Retrieves the current active transcription for a project / audio source.
   */
  async getActiveTranscription(
    projectId: string,
    audioSourceId?: string
  ): Promise<TranscriptionRecord | null> {
    if (audioSourceId) {
      const source = await this.audioSourceRepository.findById(audioSourceId);
      if (source?.activeTranscriptionId) {
        return this.transcriptionRepository.findById(source.activeTranscriptionId);
      }
    }

    const sources = await this.audioSourceRepository.findByProjectId(projectId);
    for (const source of sources) {
      if (source.activeTranscriptionId) {
        const active = await this.transcriptionRepository.findById(
          source.activeTranscriptionId
        );
        if (active) return active;
      }
    }

    return null;
  }

  /**
   * Feeds the canonical transcript of an accepted transcription directly into AIVA Director
   * preserving durable source provenance.
   */
  async useWithDirector(
    projectId: string,
    transcriptionId: string,
    options: UseWithDirectorInput = {}
  ): Promise<DirectorPlan> {
    const transcription = await this.transcriptionRepository.findById(transcriptionId);
    if (!transcription || transcription.projectId !== projectId) {
      throw new NotFoundError("Transcription not found for this project", {
        transcriptionId,
        projectId,
      });
    }

    if (!transcription.canonicalText || transcription.canonicalText.trim().length === 0) {
      throw new ValidationError("Transcription contains no recognized canonical text to analyze");
    }

    // Call Director with explicit AUDIO_TRANSCRIPT source type and durable provenance references
    const plan = await this.directorService.analyzeAndPlan(projectId, {
      script: transcription.canonicalText,
      brandId: options.brandId,
      productId: options.productId,
      sourceType: "AUDIO_TRANSCRIPT",
      sourceTranscriptionId: transcription.id,
      sourceAudioHash: transcription.sourceAudioHash,
    });

    this.logger.info({
      event: "transcription.used_with_director",
      projectId,
      transcriptionId,
      directorPlanId: plan.id,
      sourceType: "AUDIO_TRANSCRIPT",
      wordCount: transcription.wordCount,
    });

    return plan;
  }
}
