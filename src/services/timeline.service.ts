import { DomainError, NotFoundError } from "@/domain/errors";
import { mapScenesToTimedTokens, type TimedToken, type TimelineDto, type TimingSourceType } from "@/domain/timeline";
import type { ProjectRepository, DirectorPlanRepository, AudioSourceRepository, TranscriptionRepository } from "@/repositories";
import type { VoiceTrackRepository } from "@/repositories/voice-track.repository";
import type { DirectorPlan } from "@/domain/director";

interface TimelineRepositoryLike {
  findByIdentity(projectId: string, planId: string, type: TimingSourceType, sourceId: string): Promise<TimelineDto | null>;
  create(data: Omit<TimelineDto, "id" | "createdAt">): Promise<TimelineDto>;
}

interface ResolvedTimingSource {
  timingSourceType: TimingSourceType;
  timingSourceId: string;
  totalDurationMs: number;
  tokens: TimedToken[];
}

export class TimelineService {
  constructor(private readonly deps: { projectRepository: ProjectRepository; directorPlanRepository: DirectorPlanRepository; voiceTrackRepository: VoiceTrackRepository; audioSourceRepository: AudioSourceRepository; transcriptionRepository: TranscriptionRepository; timelineRepository: TimelineRepositoryLike }) {}

  private async resolveTimingSource(projectId: string, plan: DirectorPlan, required: boolean): Promise<ResolvedTimingSource | null> {
    const unavailable = (code: string, message: string): null => {
      if (required) throw new DomainError(code, message);
      return null;
    };

    if (plan.sourceType === "AUDIO_TRANSCRIPT") {
      if (!plan.sourceTranscriptionId) return unavailable("STALE_DIRECTOR_PLAN", "Audio Director plan has no source transcription");
      const transcription = await this.deps.transcriptionRepository.findById(plan.sourceTranscriptionId);
      if (!transcription || transcription.projectId !== projectId) return unavailable("STALE_DIRECTOR_PLAN", "Director transcription is missing or belongs to another project");
      const source = await this.deps.audioSourceRepository.findById(transcription.audioSourceId);
      if (!source || source.projectId !== projectId || source.activeTranscriptionId !== transcription.id) return unavailable("STALE_DIRECTOR_PLAN", "Director plan is based on a stale audio transcription");
      const tokens = (transcription.words ?? []).map((word) => ({ text: word.text, sourceStart: word.sourceStart, sourceEnd: word.sourceEnd, startMs: word.startMs, endMs: word.endMs }));
      return { timingSourceType: "TRANSCRIPTION", timingSourceId: transcription.id, tokens, totalDurationMs: source.durationMs ?? transcription.durationMs ?? tokens.at(-1)?.endMs ?? 0 };
    }

    const track = await this.deps.voiceTrackRepository.getCurrentForProject(projectId);
    if (!track || track.projectId !== projectId || track.directorPlanId !== plan.id || track.sourceScriptHash !== plan.scriptHash) return unavailable("VOICE_TRACK_REQUIRED", "Generate narration for the current Director plan first");
    const tokens = track.boundaries.map((boundary) => ({ text: plan.originalScript.slice(boundary.sourceStart, boundary.sourceEnd), sourceStart: boundary.sourceStart, sourceEnd: boundary.sourceEnd, startMs: boundary.audioStartMs, endMs: boundary.audioStartMs + boundary.audioDurationMs }));
    return { timingSourceType: "VOICE_TRACK", timingSourceId: track.id, tokens, totalDurationMs: track.durationMs ?? tokens.at(-1)?.endMs ?? 0 };
  }

  async getCurrent(projectId: string): Promise<TimelineDto | null> {
    if (!(await this.deps.projectRepository.findById(projectId))) throw new NotFoundError("Project not found", { projectId });
    const plan = await this.deps.directorPlanRepository.findByProjectId(projectId);
    if (!plan) return null;
    const source = await this.resolveTimingSource(projectId, plan, false);
    return source ? this.deps.timelineRepository.findByIdentity(projectId, plan.id, source.timingSourceType, source.timingSourceId) : null;
  }

  async build(projectId: string): Promise<TimelineDto> {
    if (!(await this.deps.projectRepository.findById(projectId))) throw new NotFoundError("Project not found", { projectId });
    const plan = await this.deps.directorPlanRepository.findByProjectId(projectId);
    if (!plan) throw new DomainError("DIRECTOR_PLAN_REQUIRED", "Generate a Director plan first");

    const source = await this.resolveTimingSource(projectId, plan, true);
    if (!source) throw new DomainError("TIMING_SOURCE_REQUIRED", "Current timing source is unavailable");
    const { timingSourceType, timingSourceId, totalDurationMs, tokens } = source;

    const existing = await this.deps.timelineRepository.findByIdentity(projectId, plan.id, timingSourceType, timingSourceId);
    if (existing) return existing;
    const scenes = mapScenesToTimedTokens(plan.scenes, tokens);
    return this.deps.timelineRepository.create({ projectId, directorPlanId: plan.id, timingSourceType, timingSourceId, totalDurationMs, scenes });
  }
}
