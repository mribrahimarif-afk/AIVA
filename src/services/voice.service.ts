import crypto from "node:crypto";
import { getEnv } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/logging/logger";
import { NotFoundError, DomainError, DataIntegrityError, ProviderError } from "@/domain/errors";
import {
  DEFAULT_VOICE,
  SUPPORTED_VOICES,
  SupportedVoice,
  VOICE_PROFILES,
  GenerateVoiceInput,
  VoiceTrackDto,
  VoiceTrackWithBoundariesDto,
  validateVoiceSynthesis,
} from "@/domain/voice";
import { ProjectRepository, DirectorPlanRepository } from "@/repositories";
import { VoiceTrackRepository } from "@/repositories/voice-track.repository";
import { toVoiceTrackDto, toVoiceTrackWithBoundariesDto } from "@/repositories/mappers";
import { VoiceProvider } from "@/providers/voice";
import { VoiceStorageService } from "@/storage/voice-storage.service";

export interface VoiceServiceDependencies {
  projectRepository: ProjectRepository;
  directorPlanRepository: DirectorPlanRepository;
  voiceTrackRepository: VoiceTrackRepository;
  voiceProvider: VoiceProvider;
  voiceStorageService: VoiceStorageService;
}

export class VoiceService {
  constructor(private readonly deps: VoiceServiceDependencies) {}

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

    // 4. Validate requested voice
    const requestedVoice = input.voiceName ?? (env.AZURE_SPEECH_VOICE as SupportedVoice) ?? DEFAULT_VOICE;
    if (!(SUPPORTED_VOICES as readonly string[]).includes(requestedVoice)) {
      throw new DomainError("INVALID_VOICE", `Unsupported voice profile: ${requestedVoice}`);
    }
    const voiceName = requestedVoice as SupportedVoice;

    // 5. Preflight check: provider configuration
    if (!this.deps.voiceProvider.isConfigured()) {
      throw new ProviderError(this.deps.voiceProvider.id, "Azure Speech provider is not configured", {
        code: "VOICE_UNCONFIGURED",
      });
    }

    // 6. Idempotent reuse: if not forced and identical valid track already exists on disk
    if (!input.force) {
      const existingTrack = await this.deps.voiceTrackRepository.getCurrentForProject(projectId);
      if (
        existingTrack &&
        existingTrack.sourceScriptHash === directorPlan.scriptHash &&
        existingTrack.voiceName === voiceName
      ) {
        const fileExists = await this.deps.voiceStorageService.audioFileExists(existingTrack.audioStorageRef);
        if (fileExists) {
          logger.info({
            event: "voice.reused_existing",
            projectId,
            directorPlanId: directorPlan.id,
            scriptHash: directorPlan.scriptHash,
            voiceName,
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

    // 7. Synthesize audio via VoiceProvider (plain-text, exact originalScript)
    const startTime = Date.now();
    const synthesisResult = await this.deps.voiceProvider.synthesize({
      text: capturedOriginalScript,
      voiceName,
    });
    const latencyMs = Date.now() - startTime;

    // 8. Validate synthesis result against 14 invariants, byte limits, and transient event text alignment
    const validated = validateVoiceSynthesis(synthesisResult, {
      originalScript: capturedOriginalScript,
      maxDurationMs: env.VOICE_MAX_DURATION_MS,
      maxAudioBytes: env.VOICE_MAX_AUDIO_BYTES,
    });

    // 9. Stage and atomically publish content-addressed WAV audio
    const published = await this.deps.voiceStorageService.stageAndPublishAudio(
      synthesisResult.audioData,
      projectId
    );

    // 10. Persist VoiceTrack and boundaries inside repository transaction (with in-tx TOCTOU check)
    try {
      const persisted = await this.deps.voiceTrackRepository.replaceTrack({
        projectId,
        directorPlanId: capturedDirectorPlanId,
        sourceScriptHash: capturedScriptHash,
        provider: this.deps.voiceProvider.id,
        voiceName,
        locale: VOICE_PROFILES[voiceName]?.locale ?? "ur-PK",
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
