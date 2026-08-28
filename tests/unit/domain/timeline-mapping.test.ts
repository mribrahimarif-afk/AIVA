import { describe, expect, it } from "vitest";
import { mapScenesToTimedTokens, type TimedToken } from "@/domain/timeline";

const scene = (id: string, order: number, start: number, end: number, text = "spoken") => ({ id, order, sourceSpanStart: start, sourceSpanEnd: end, text } as any);

describe("deterministic scene timeline mapping", () => {
  it("maps VoiceBoundary-normalized tokens to exact scene timing", () => {
    const tokens: TimedToken[] = [{ text: "Hello", sourceStart: 0, sourceEnd: 5, startMs: 0, endMs: 420 }, { text: "world", sourceStart: 6, sourceEnd: 11, startMs: 500, endMs: 900 }];
    expect(mapScenesToTimedTokens([scene("s1", 1, 0, 11)], tokens)[0]).toMatchObject({ startMs: 0, endMs: 900, durationMs: 900 });
  });

  it("maps TranscriptionWord-normalized tokens through the same algorithm", () => {
    const tokens: TimedToken[] = [{ text: "one", sourceStart: 0, sourceEnd: 3, startMs: 100, endMs: 350 }, { text: "two", sourceStart: 5, sourceEnd: 8, startMs: 500, endMs: 800 }];
    expect(mapScenesToTimedTokens([scene("s1", 1, 0, 4), scene("s2", 2, 4, 9)], tokens).map((s) => [s.startMs, s.endMs])).toEqual([[100, 350], [500, 800]]);
  });

  it("does not require punctuation or whitespace tokens", () => {
    const tokens: TimedToken[] = [{ text: "Hello", sourceStart: 0, sourceEnd: 5, startMs: 0, endMs: 300 }, { text: "world", sourceStart: 7, sourceEnd: 12, startMs: 450, endMs: 800 }];
    expect(mapScenesToTimedTokens([scene("s1", 1, 0, 12, "Hello, world")], tokens)[0]?.endMs).toBe(800);
  });

  it("fails rather than fabricating timing for narrated unmappable scenes", () => {
    expect(() => mapScenesToTimedTokens([scene("s1", 1, 20, 30)], [{ text: "other", sourceStart: 0, sourceEnd: 5, startMs: 0, endMs: 300 }])).toThrow(/no overlapping timed tokens/);
  });
});
