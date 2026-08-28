import { describe, it, expect } from "vitest";
import {
  buildCanonicalTranscript,
  validateTranscriptionWords,
  assertValidTranscriptionWords,
} from "@/domain/transcription";
import { ValidationError } from "@/domain/errors";

describe("Canonical Transcript Builder & Invariants (TASK-004B)", () => {
  it("reconstructs canonicalText and satisfies exact UTF-16 slice invariants for English words", () => {
    const rawWords = [
      { text: "Welcome", startMs: 0, endMs: 450 },
      { text: "to", startMs: 460, endMs: 600 },
      { text: "AIVA", startMs: 620, endMs: 950 },
      { text: "Studio", startMs: 960, endMs: 1400 },
    ];

    const result = buildCanonicalTranscript(rawWords);
    expect(result.canonicalText).toBe("Welcome to AIVA Studio");
    expect(result.words).toHaveLength(4);

    for (const w of result.words) {
      const slice = result.canonicalText.slice(w.sourceStart, w.sourceEnd);
      expect(slice).toBe(w.text);
    }

    expect(result.words[0]).toMatchObject({ sequence: 1, text: "Welcome", sourceStart: 0, sourceEnd: 7 });
    expect(result.words[1]).toMatchObject({ sequence: 2, text: "to", sourceStart: 8, sourceEnd: 10 });
    expect(result.words[2]).toMatchObject({ sequence: 3, text: "AIVA", sourceStart: 11, sourceEnd: 15 });
    expect(result.words[3]).toMatchObject({ sequence: 4, text: "Studio", sourceStart: 16, sourceEnd: 22 });
  });

  it("handles repeated identical words without ambiguous offsets", () => {
    const rawWords = [
      { text: "bohat", startMs: 0, endMs: 300 },
      { text: "bohat", startMs: 310, endMs: 600 },
      { text: "shukriya", startMs: 610, endMs: 1100 },
    ];

    const result = buildCanonicalTranscript(rawWords);
    expect(result.canonicalText).toBe("bohat bohat shukriya");
    expect(result.words[0]!.sourceStart).toBe(0);
    expect(result.words[0]!.sourceEnd).toBe(5);
    expect(result.words[1]!.sourceStart).toBe(6);
    expect(result.words[1]!.sourceEnd).toBe(11);
    expect(result.words[2]!.sourceStart).toBe(12);
    expect(result.words[2]!.sourceEnd).toBe(20);

    for (const w of result.words) {
      expect(result.canonicalText.slice(w.sourceStart, w.sourceEnd)).toBe(w.text);
    }
  });

  it("preserves Urdu Nastaliq and Unicode characters accurately", () => {
    const rawWords = [
      { text: "خوش", startMs: 0, endMs: 400 },
      { text: "آمدید", startMs: 410, endMs: 900 },
      { text: "پاکستان", startMs: 950, endMs: 1600 },
    ];

    const result = buildCanonicalTranscript(rawWords);
    expect(result.canonicalText).toBe("خوش آمدید پاکستان");

    for (const w of result.words) {
      expect(result.canonicalText.slice(w.sourceStart, w.sourceEnd)).toBe(w.text);
    }
  });

  it("handles Roman Urdu and English mixed code-switching with punctuation in tokens", () => {
    const rawWords = [
      { text: "Yeh", startMs: 0, endMs: 250 },
      { text: "product,", startMs: 260, endMs: 650 },
      { text: "bohat", startMs: 660, endMs: 950 },
      { text: "amazing", startMs: 960, endMs: 1400 },
      { text: "hai!", startMs: 1410, endMs: 1750 },
    ];

    const result = buildCanonicalTranscript(rawWords);
    expect(result.canonicalText).toBe("Yeh product, bohat amazing hai!");

    for (const w of result.words) {
      expect(result.canonicalText.slice(w.sourceStart, w.sourceEnd)).toBe(w.text);
    }
  });

  it("rejects empty word text in input sequence", () => {
    const rawWords = [
      { text: "Valid", startMs: 0, endMs: 300 },
      { text: "   ", startMs: 310, endMs: 500 },
    ];

    expect(() => buildCanonicalTranscript(rawWords)).toThrow(ValidationError);
  });

  it("validates timing monotonicity, negative values, and end before start", () => {
    // Valid sequence
    const validWords = [
      { text: "Word1", startMs: 0, endMs: 200 },
      { text: "Word2", startMs: 250, endMs: 500 },
    ];
    expect(validateTranscriptionWords(validWords).valid).toBe(true);

    // Negative start
    expect(validateTranscriptionWords([{ text: "Bad", startMs: -10, endMs: 200 }]).valid).toBe(false);

    // End before start
    expect(validateTranscriptionWords([{ text: "Bad", startMs: 300, endMs: 200 }]).valid).toBe(false);

    // Non-monotonic start
    expect(
      validateTranscriptionWords([
        { text: "First", startMs: 400, endMs: 600 },
        { text: "Backwards", startMs: 200, endMs: 300 },
      ]).valid
    ).toBe(false);

    // NaN / Infinity
    expect(validateTranscriptionWords([{ text: "Bad", startMs: NaN, endMs: 200 }]).valid).toBe(false);
    expect(validateTranscriptionWords([{ text: "Bad", startMs: 0, endMs: Infinity }]).valid).toBe(false);
  });

  it("handles NO_SPEECH empty arrays gracefully when allowed", () => {
    const result = validateTranscriptionWords([], { allowEmpty: true });
    expect(result.valid).toBe(true);
    expect(result.durationMs).toBe(0);

    expect(() => assertValidTranscriptionWords([], { allowEmpty: false })).toThrow(ValidationError);
  });
});
