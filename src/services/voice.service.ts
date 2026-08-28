import crypto from "node:crypto";
import { getEnv } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/logging/logger";
import { NotFoundError, DomainError, DataIntegrityError, ProviderError } from "@/domain/errors";
import {
  DEFAULT_VOICE,
  SUPPORTED_VOICES,
  SupportedVoice,
  VOICE_PROFILES,
  VOICE_OUTPUT_FORMAT,
  GenerateVoiceInput,
  VoiceTrackDto,
  VoiceTrackWithBoundariesDto,
  validateVoiceSynthesis,
} from "@/domain/voice";
import {
  ProjectRepository,
  DirectorPlanRepository,
  AudioSourceRepository,
  TranscriptionRepository,
} from "@/repositories";
import { VoiceTrackRepository } from "@/repositories/voice-track.repository";
import { toVoiceTrackDto, toVoiceTrackWithBoundariesDto } from "@/repositories/mappers";
import { VoiceProvider } from "@/providers/voice";
import { VoiceStorageService } from "@/storage/voice-storage.service";

export interface VoiceServiceDependencies {
  projectRepository: ProjectRepository;
  directorPlanRepository: DirectorPlanRepository;
  voiceTrackRepository: VoiceTrackRepository;
  audioSourceRepository?: AudioSourceRepository;
  transcriptionRepository?: TranscriptionRepository;
  voiceProvider?: VoiceProvider; // Legacy fallback
  voiceProviders?: Record<string, VoiceProvider>;
  voiceStorageService: VoiceStorageService;
}

export class VoiceService {
  private readonly providers: Map<string, VoiceProvider>;

  constructor(private readonly deps: VoiceServiceDependencies) {
    this.providers = new Map();
    if (deps.voiceProviders) {
      for (const [key, provider] of Object.entries(deps.voiceProviders)) {
        this.providers.set(key.toLowerCase(), provider);
      }
    }
    if (deps.voiceProvider) {
      this.providers.set("azure", deps.voiceProvider);
      this.providers.set("azure-speech", deps.voiceProvider);
    }
  }

  getProvider(providerId?: string): VoiceProvider {
    const rawId = (providerId || "AZURE").trim().toLowerCase();

    if (rawId === "azure" || rawId === "azure-speech") {
      const provider = this.providers.get("azure") || this.providers.get("azure-speech") || this.deps.voiceProvider;
      if (!provider) {
        throw new ProviderError("azure-speech", "Azure Speech provider is not registered", {
          code: "VOICE_UNCONFIGURED",
        });
      }
      return provider;
    }

    if (rawId === "elevenlabs") {
      const provider = this.providers.get("elevenlabs");
      if (!provider) {
        throw new ProviderError("elevenlabs", "ElevenLabs provider is not registered", {
          code: "VOICE_UNCONFIGURED",
        });
      }
      return provider;
    }

    throw new DomainError("INVALID_PROVIDER", `Unsupported voice provider: ${providerId}`);
  }

  private async assertDirectorPlanUsable(projectId: string, directorPlan: { sourceType?: string; sourceTranscriptionId?: string | null; id: string }): Promise<void> {
    if (directorPlan.sourceType === "AUDIO_TRANSCRIPT") {
      if (!directorPlan.sourceTranscriptionId) {
        throw new DomainError(
          "STALE_DIRECTOR_PLAN",
          "Audio-First Director plan lacks source transcription reference and cannot be used for Voice generation."
        );
      }

      if (this.deps.transcriptionRepository) {
        const transcription = await this.deps.transcriptionRepository.findById(directorPlan.sourceTranscriptionId);
        if (!transcription || transcription.projectId !== projectId) {
          throw new DomainError(
            "STALE_DIRECTOR_PLAN",
            "Audio-First Director plan references a non-existent or foreign transcription and cannot be used for Voice generation."
          );
        }

        if (this.deps.audioSourceRepository) {
          const audioSource = await this.deps.audioSourceRepository.findById(transcription.audioSourceId);
          if (!audioSource || audioSource.activeTranscriptionId !== directorPlan.sourceTranscriptionId) {
            throw new DomainError(
              "STALE_DIRECTOR_PLAN",
              "Audio-First Director plan is based on a stale transcription. Re-run Director with the active transcription first."
            );
          }
        }
      }
    }
  }

  async getVoiceTrack(projectId: string): Promise<VoiceTrackDto | null> {
    const project = await this.deps.projectRepository.findById(projectId);
    if (!project) {
      throw new NotFoundError("Project not found", { id: projectId });
    }

    const directorPlan = await this.deps.directorPlanRepository.findByProjectId(projectId);
    const track = await this.deps.voiceTrackRepository.getCurrentForProject(projectId);

    if (!track) return null;

    const currentScriptHash = directorPlan?.scriptHash ?? "";
    return toVoiceTrackDto(track, currentScriptHash);
  }

  async getVoiceTrackWithBoundaries(projectId: string): Promise<VoiceTrackWithBoundariesDto | null> {
    const project = await this.deps.projectRepository.findById(projectId);
    if (!project) {
      throw new NotFoundError("Project not found", { id: projectId });
    }

    const directorPlan = await this.deps.directorPlanRepository.findByProjectId(projectId);
    const track = await this.deps.voiceTrackRepository.getCurrentForProject(projectId);

    if (!track) return null;

    const currentScriptHash = directorPlan?.scriptHash ?? "";
    const originalScript = directorPlan?.originalScript ?? "";
    return toVoiceTrackWithBoundariesDto(track, currentScriptHash, originalScript);
  }

  async generateVoice(projectId: string, input: GenerateVoiceInput = {}): Promise<VoiceTrackDto> {
    const env = getEnv();

    // 1. Verify project existence
    const project = await this.deps.projectRepository.findById(projectId);
    if (!project) {
      throw new NotFoundError("Project not found", { id: projectId });
    }

    // 2. Load current DirectorPlan (strict requirement: TASK-004 requires valid DirectorPlan)
    const directorPlan = await this.deps.directorPlanRepository.findByProjectId(projectId);
    if (!directorPlan) {
      throw new DomainError(
        "DIRECTOR_PLAN_REQUIRED",
        "A valid Director plan is required before generating voice narration. Analyze the script first."
      );
    }

    // 2b. Assert that Audio-First Director plan is current and usable (not stale)
    await this.assertDirectorPlanUsable(projectId, directorPlan);

    // 3. Exact script fidelity & hash verification before calling provider
    const calculatedHash = crypto.createHash("sha256").update(directorPlan.originalScript).digest("hex").toLowerCase();
    if (calculatedHash !== directorPlan.scriptHash) {
      throw new DataIntegrityError(
        "Director plan scriptHash mismatch: originalScript integrity corrupted",
        {
          field: "DirectorPlan.scriptHash",
          recordId: directorPlan.id,
        }
      );
    }

    // 4. Resolve explicitly selected provider
    const providerInstance = this.getProvider(input.provider);

    // 5. Preflight check: provider configuration (No silent fallback to other providers!)
    if (!providerInstance.isConfigured()) {
      const providerName = providerInstance.id === "elevenlabs" ? "ElevenLabs" : "Azure Speech";
      throw new ProviderError(providerInstance.id, `${providerName} provider is not configured`, {
        code: "VOICE_UNCONFIGURED",
      });
    }

    // 6. Validate and resolve voiceName & model based on provider
    let voiceName: string;
    let locale: string;
    const model = providerInstance.defaultModel;

    if (providerInstance.id === "azure-speech" || providerInstance.id === "azure") {
      const requestedVoice = input.voiceName ?? (env.AZURE_SPEECH_VOICE as SupportedVoice) ?? DEFAULT_VOICE;
      if (!(SUPPORTED_VOICES as readonly string[]).includes(requestedVoice)) {
        throw new DomainError("INVALID_VOICE", `Unsupported voice profile: ${requestedVoice}`);
      }
      voiceName = requestedVoice;
      locale = VOICE_PROFILES[requestedVoice as SupportedVoice]?.locale ?? "ur-PK";
    } else {
      // ElevenLabs: require explicit voiceName or configured default
      const requestedVoice = input.voiceName?.trim();
      const resolvedVoice = requestedVoice || providerInstance.defaultVoice?.trim();
      if (!resolvedVoice) {
        throw new DomainError("INVALID_VOICE", "An explicit ElevenLabs voice must be selected");
      }
      voiceName = resolvedVoice;
      locale = "multilingual";
    }

    // 7. Composite Idempotent Reuse: match sourceScriptHash + provider + voiceName + model + outputFormat
    if (!input.force) {
      const existingTrack = await this.deps.voiceTrackRepository.getCurrentForProject(projectId);
      if (
        existingTrack &&
        existingTrack.directorPlanId === directorPlan.id &&
        existingTrack.sourceScriptHash === directorPlan.scriptHash &&
        existingTrack.provider === providerInstance.id &&
        existingTrack.voiceName === voiceName &&
        existingTrack.model === model &&
        existingTrack.outputFormat === VOICE_OUTPUT_FORMAT
      ) {
        const fileExists = await this.deps.voiceStorageService.audioFileExists(existingTrack.audioStorageRef);
        if (fileExists) {
          logger.info({
            event: "voice.reused_existing",
            projectId,
            directorPlanId: directorPlan.id,
            scriptHash: directorPlan.scriptHash,
            provider: providerInstance.id,
            model,
            voiceName,
            outputFormat: VOICE_OUTPUT_FORMAT,
            storageRef: existingTrack.audioStorageRef,
          });
          return toVoiceTrackDto(existingTrack, directorPlan.scriptHash);
        }
      }
    }

    // Capture pre-synthesis snapshot for TOCTOU verification
    const capturedDirectorPlanId = directorPlan.id;
    const capturedScriptHash = directorPlan.scriptHash;
    const capturedOriginalScript = directorPlan.originalScript;

    // 8. Synthesize audio via chosen VoiceProvider strictly (No auto-fallback on failure!)
    const startTime = Date.now();
    const synthesisResult = await providerInstance.synthesize({
      text: capturedOriginalScript,
      voiceName,
      modelId: model,
    });
    const latencyMs = Date.now() - startTime;

    // 9. Validate synthesis result against 14 invariants, byte limits, and transient event text alignment
    const validated = validateVoiceSynthesis(synthesisResult, {
      originalScript: capturedOriginalScript,
      maxDurationMs: env.VOICE_MAX_DURATION_MS,
      maxAudioBytes: env.VOICE_MAX_AUDIO_BYTES,
    });

    // 10. Stage and atomically publish content-addressed WAV audio
    const published = await this.deps.voiceStorageService.stageAndPublishAudio(
      synthesisResult.audioData,
      projectId
    );

    // 11. Persist VoiceTrack and boundaries inside repository transaction (with in-tx TOCTOU check)
    try {
      const persisted = await this.deps.voiceTrackRepository.replaceTrack({
        projectId,
        directorPlanId: capturedDirectorPlanId,
        sourceScriptHash: capturedScriptHash,
        provider: providerInstance.id,
        model,
        voiceName,
        locale,
        outputFormat: synthesisResult.outputFormat,
        audioSha256: published.audioSha256,
        audioByteCount: published.audioByteCount,
        audioStorageRef: published.storageRef,
        durationMs: validated.durationMs,
        boundaries: validated.boundaries,
      });

      logger.info({
        event: "voice.track_generated",
        projectId,
        directorPlanId: capturedDirectorPlanId,
        scriptHash: capturedScriptHash,
        provider: providerInstance.id,
        model,
        voiceName,
        durationMs: validated.durationMs,
        boundaryCount: validated.boundaries.length,
        audioByteCount: published.audioByteCount,
        latencyMs,
      });

      return toVoiceTrackDto(persisted, capturedScriptHash);
    } catch (err: unknown) {
      // V1 Safe Orphan Compensation Policy:
      // Temp files are already cleaned by stageAndPublishAudio.
      // Finalized content-addressed WAV files are preserved on disk as safe orphans to prevent
      // deleting files concurrently referenced by another operation.
      throw err;
    }
  }
}
