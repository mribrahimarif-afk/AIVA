import { describe, expect, it, vi } from "vitest";
import { TimelineService } from "@/services/timeline.service";

const project = { id: "p1" };
const basePlan = { id: "plan1", projectId: "p1", sourceType: "SCRIPT", sourceTranscriptionId: null, scriptHash: "hash", originalScript: "Hello world", scenes: [{ id: "s1", order: 1, text: "Hello world", sourceSpanStart: 0, sourceSpanEnd: 11 }] };
function deps(overrides: Record<string, any> = {}) {
  const timelineRepository = { findByIdentity: vi.fn().mockResolvedValue(null), findCurrent: vi.fn().mockResolvedValue(null), create: vi.fn(async (x) => ({ id: "tl1", createdAt: new Date(), ...x })) };
  return { projectRepository: { findById: vi.fn().mockResolvedValue(project) }, directorPlanRepository: { findByProjectId: vi.fn().mockResolvedValue(basePlan) }, voiceTrackRepository: { getCurrentForProject: vi.fn().mockResolvedValue({ id: "v1", projectId: "p1", directorPlanId: "plan1", sourceScriptHash: "hash", durationMs: 1000, boundaries: [{ sourceStart: 0, sourceEnd: 5, audioStartMs: 0, audioDurationMs: 400 }, { sourceStart: 6, sourceEnd: 11, audioStartMs: 500, audioDurationMs: 500 }] }) }, audioSourceRepository: { findById: vi.fn() }, transcriptionRepository: { findById: vi.fn() }, timelineRepository, ...overrides } as any;
}

describe("TimelineService", () => {
  it("uses current VoiceTrack boundaries and native duration for Script mode", async () => {
    const d = deps(); const result = await new TimelineService(d).build("p1");
    expect(result.timingSourceType).toBe("VOICE_TRACK"); expect(result.totalDurationMs).toBe(1000); expect(d.transcriptionRepository.findById).not.toHaveBeenCalled();
  });

  it("uses the exact Director transcription words for Audio mode without TTS", async () => {
    const plan = { ...basePlan, sourceType: "AUDIO_TRANSCRIPT", sourceTranscriptionId: "t1" };
    const d = deps({ directorPlanRepository: { findByProjectId: vi.fn().mockResolvedValue(plan) }, transcriptionRepository: { findById: vi.fn().mockResolvedValue({ id: "t1", projectId: "p1", audioSourceId: "a1", durationMs: 1200, words: [{ text: "Hello", sourceStart: 0, sourceEnd: 5, startMs: 100, endMs: 500 }, { text: "world", sourceStart: 6, sourceEnd: 11, startMs: 600, endMs: 1100 }] }) }, audioSourceRepository: { findById: vi.fn().mockResolvedValue({ id: "a1", projectId: "p1", activeTranscriptionId: "t1", durationMs: 1200 }) } });
    const result = await new TimelineService(d).build("p1"); expect(result.timingSourceType).toBe("TRANSCRIPTION"); expect(d.voiceTrackRepository.getCurrentForProject).not.toHaveBeenCalled();
  });

  it("rejects stale Audio Director plans", async () => {
    const plan = { ...basePlan, sourceType: "AUDIO_TRANSCRIPT", sourceTranscriptionId: "t1" };
    const d = deps({ directorPlanRepository: { findByProjectId: vi.fn().mockResolvedValue(plan) }, transcriptionRepository: { findById: vi.fn().mockResolvedValue({ id: "t1", projectId: "p1", audioSourceId: "a1", words: [] }) }, audioSourceRepository: { findById: vi.fn().mockResolvedValue({ id: "a1", projectId: "p1", activeTranscriptionId: "t2" }) } });
    await expect(new TimelineService(d).build("p1")).rejects.toThrow(/stale audio transcription/);
  });

  it("reuses identical plan and timing source without another persistence write", async () => {
    const existing = { id: "existing", directorPlanId: "plan1", timingSourceType: "VOICE_TRACK", timingSourceId: "v1", scenes: [] };
    const d = deps(); d.timelineRepository.findByIdentity.mockResolvedValue(existing);
    expect((await new TimelineService(d).build("p1")).id).toBe("existing"); expect(d.timelineRepository.create).not.toHaveBeenCalled();
  });
});
