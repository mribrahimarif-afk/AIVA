import { DomainError, NotFoundError } from "@/domain/errors";
import { mapScenesToTimedTokens, type TimedToken, type TimelineDto, type TimingSourceType } from "@/domain/timeline";
import type { ProjectRepository, DirectorPlanRepository, AudioSourceRepository, TranscriptionRepository } from "@/repositories";
import type { VoiceTrackRepository } from "@/repositories/voice-track.repository";

interface TimelineRepositoryLike {
  findByIdentity(planId: string, type: TimingSourceType, sourceId: string): Promise<TimelineDto | null>;
  findCurrent(projectId: string, planId: string): Promise<TimelineDto | null>;
  create(data: Omit<TimelineDto, "id" | "createdAt">): Promise<TimelineDto>;
}

export class TimelineService {
  constructor(private readonly deps: { projectRepository: ProjectRepository; directorPlanRepository: DirectorPlanRepository; voiceTrackRepository: VoiceTrackRepository; audioSourceRepository: AudioSourceRepository; transcriptionRepository: TranscriptionRepository; timelineRepository: TimelineRepositoryLike }) {}

  async getCurrent(projectId: string): Promise<TimelineDto | null> {
    if (!(await this.deps.projectRepository.findById(projectId))) throw new NotFoundError("Project not found", { projectId });
    const plan = await this.deps.directorPlanRepository.findByProjectId(projectId);
    return plan ? this.deps.timelineRepository.findCurrent(projectId, plan.id) : null;
  }

  async build(projectId: string): Promise<TimelineDto> {
    if (!(await this.deps.projectRepository.findById(projectId))) throw new NotFoundError("Project not found", { projectId });
    const plan = await this.deps.directorPlanRepository.findByProjectId(projectId);
    if (!plan) throw new DomainError("DIRECTOR_PLAN_REQUIRED", "Generate a Director plan first");

    let timingSourceType: TimingSourceType;
    let timingSourceId: string;
    let totalDurationMs: number;
    let tokens: TimedToken[];

    if (plan.sourceType === "AUDIO_TRANSCRIPT") {
      if (!plan.sourceTranscriptionId) throw new DomainError("STALE_DIRECTOR_PLAN", "Audio Director plan has no source transcription");
      const transcription = await this.deps.transcriptionRepository.findById(plan.sourceTranscriptionId);
      if (!transcription || transcription.projectId !== projectId) throw new DomainError("STALE_DIRECTOR_PLAN", "Director transcription is missing or belongs to another project");
      const source = await this.deps.audioSourceRepository.findById(transcription.audioSourceId);
      if (!source || source.projectId !== projectId || source.activeTranscriptionId !== transcription.id) throw new DomainError("STALE_DIRECTOR_PLAN", "Director plan is based on a stale audio transcription");
      timingSourceType = "TRANSCRIPTION";
      timingSourceId = transcription.id;
      tokens = (transcription.words ?? []).map((word) => ({ text: word.text, sourceStart: word.sourceStart, sourceEnd: word.sourceEnd, startMs: word.startMs, endMs: word.endMs }));
      totalDurationMs = source.durationMs ?? transcription.durationMs ?? tokens.at(-1)?.endMs ?? 0;
    } else {
      const track = await this.deps.voiceTrackRepository.getCurrentForProject(projectId);
      if (!track || track.projectId !== projectId || track.directorPlanId !== plan.id || track.sourceScriptHash !== plan.scriptHash) throw new DomainError("VOICE_TRACK_REQUIRED", "Generate narration for the current Director plan first");
      timingSourceType = "VOICE_TRACK";
      timingSourceId = track.id;
      tokens = track.boundaries.map((boundary) => ({ text: plan.originalScript.slice(boundary.sourceStart, boundary.sourceEnd), sourceStart: boundary.sourceStart, sourceEnd: boundary.sourceEnd, startMs: boundary.audioStartMs, endMs: boundary.audioStartMs + boundary.audioDurationMs }));
      totalDurationMs = track.durationMs ?? tokens.at(-1)?.endMs ?? 0;
    }

    const existing = await this.deps.timelineRepository.findByIdentity(plan.id, timingSourceType, timingSourceId);
    if (existing) return existing;
    const scenes = mapScenesToTimedTokens(plan.scenes, tokens);
    return this.deps.timelineRepository.create({ projectId, directorPlanId: plan.id, timingSourceType, timingSourceId, totalDurationMs, scenes });
  }
}
