export const TIMING_SOURCE_TYPES = ["VOICE_TRACK", "TRANSCRIPTION"] as const;
export type TimingSourceType = (typeof TIMING_SOURCE_TYPES)[number];

export interface TimedToken { text: string; sourceStart: number; sourceEnd: number; startMs: number; endMs: number }
export interface TimelineSceneDto { id?: string; directorSceneId: string; sequence: number; sourceStart: number; sourceEnd: number; startMs: number; endMs: number; durationMs: number }
export interface TimelineDto { id: string; projectId: string; directorPlanId: string; timingSourceType: TimingSourceType; timingSourceId: string; totalDurationMs: number; createdAt: Date; scenes: TimelineSceneDto[] }
