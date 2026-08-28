import { describe, it, expect, vi } from "vitest";
import { isDirectorPlanCurrent } from "@/domain/director";
import type { DirectorPlan } from "@/domain/director";

describe("Director Audio-First Currentness & Provenance Tests (TASK-004B)", () => {
  const basePlan: DirectorPlan = {
    id: "plan-1",
    projectId: "proj-1",
    originalScript: "Hello world transcript",
    scriptHash: "hash-123",
    unitizerVersion: "v1",
    schemaVersion: "1",
    promptVersion: "director-v1",
    model: "gemini-2.5-flash",
    language: "ENGLISH",
    contentType: "ADVERTISEMENT",
    summary: "Summary",
    creativeDirection: "Direction",
    brandId: null,
    productId: null,
    sourceType: "AUDIO_TRANSCRIPT",
    sourceTranscriptionId: "t1-gemini",
    sourceAudioHash: "audio-hash-123",
    generatedAt: new Date(),
    scenes: [],
  };

  it("1. P1 generated from T1 is current when AudioSource.activeTranscriptionId is T1", () => {
    const isCurrent = isDirectorPlanCurrent(basePlan, { activeTranscriptionId: "t1-gemini" });
    expect(isCurrent).toBe(true);
  });

  it("2. When T2 becomes active on the AudioSource, historical plan P1 is NOT current for A/T2", () => {
    const isCurrent = isDirectorPlanCurrent(basePlan, { activeTranscriptionId: "t2-azure" });
    expect(isCurrent).toBe(false);
  });

  it("3. Script-First plans are always current regardless of audio state", () => {
    const scriptPlan: DirectorPlan = {
      ...basePlan,
      sourceType: "SCRIPT",
      sourceTranscriptionId: null,
      sourceAudioHash: null,
    };
    expect(isDirectorPlanCurrent(scriptPlan, { activeTranscriptionId: "t2-azure" })).toBe(true);
    expect(isDirectorPlanCurrent(scriptPlan, { activeTranscriptionId: null })).toBe(true);
  });
});
