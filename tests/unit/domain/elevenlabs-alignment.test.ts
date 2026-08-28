import { describe, it, expect } from "vitest";
import {
  convertElevenLabsAlignmentToBoundaries,
  ElevenLabsAlignment,
} from "@/domain/voice/elevenlabs-alignment";
import { DomainError } from "@/domain/errors";

describe("ElevenLabs Alignment & UTF-16 Word Boundary Conversion Tests", () => {
  function buildSyntheticElevenLabsAlignment(script: string): ElevenLabsAlignment {
    // Array of individual Unicode characters / surrogate pairs or code points
    // When iterating a JS string with [...script] or split, we get code points or characters
    // ElevenLabs alignment returns array of characters
    const characters = Array.from(script);
    const start_times: number[] = [];
    const end_times: number[] = [];

    let currentSec = 0.05;
    const charDurationSec = 0.04;

    for (let i = 0; i < characters.length; i++) {
      start_times.push(Math.round(currentSec * 1000) / 1000);
      currentSec += charDurationSec;
      end_times.push(Math.round(currentSec * 1000) / 1000);
    }

    return {
      characters,
      character_start_times_seconds: start_times,
      character_end_times_seconds: end_times,
    };
  }

  const testMatrix = [
    {
      name: "1. English script with standard punctuation",
      script: "AIVA Studio delivers autonomous, intelligent video assembly.",
    },
    {
      name: "2. Urdu script with native Urdu punctuation (۔ ؟)",
      script: "یہ ایک شاندار ویڈیو ہے۔ کیا آپ تیار ہیں؟",
    },
    {
      name: "3. Roman Urdu script with mixed casing",
      script: "Yeh video bohot zabardast banegi aur AIVA ka kamaal hai.",
    },
    {
      name: "4. Mixed English, Urdu, and Roman Urdu",
      script: "AIVA Studio se apna brand boost karein اور آج ہی شروع کریں!",
    },
    {
      name: "5. Multiple spaces, tabs, blank lines, CRLF and LF",
      script: "  \t\r\nFirst line with spaces.   \r\n\r\nSecond line after blank line.\n\tThird line.\t\r\n  ",
    },
    {
      name: "6. Repeated words in sequence",
      script: "Very very fast video creation with yes yes results.",
    },
    {
      name: "7. Emoji between words and adjacent to text (surrogate pairs)",
      script: "Great video 🎬 made with AIVA 🚀✨ now! 💥",
    },
    {
      name: "8. Numbers, apostrophes, and currency symbols",
      script: "It's 100% automated and costs $50 or Rs. 15000 in 2026.",
    },
  ];

  for (const { name, script } of testMatrix) {
    it(`accurately aligns and converts boundaries with exact UTF-16 fidelity for: ${name}`, () => {
      const alignment = buildSyntheticElevenLabsAlignment(script);
      const boundaries = convertElevenLabsAlignmentToBoundaries(script, alignment);

      expect(boundaries.length).toBeGreaterThan(0);

      // Verify every reconstructed boundary matches originalScript slice exactly
      let prevSourceEnd = 0;
      let prevAudioOffset = 0;

      for (const b of boundaries) {
        expect(b.boundaryType).toBe("Word");
        expect(b.textOffset).toBeGreaterThanOrEqual(prevSourceEnd);
        expect(b.wordLength).toBeGreaterThan(0);

        const sourceStart = b.textOffset;
        const sourceEnd = sourceStart + b.wordLength;

        // Exact UTF-16 substring assertion
        const expectedSlice = script.slice(sourceStart, sourceEnd);
        expect(b.text).toBe(expectedSlice);

        // Timing monotonicity
        expect(b.audioOffsetTicks).toBeGreaterThanOrEqual(prevAudioOffset);
        expect(b.durationTicks).toBeGreaterThan(0);

        prevSourceEnd = sourceEnd;
        prevAudioOffset = b.audioOffsetTicks;
      }
    });
  }

  it("explicitly verifies surrogate-pair emoji UTF-16 offsets", () => {
    // '🎬' has UTF-16 length of 2 ('\uD83C\uDFAC')
    const script = "Video 🎬 production";
    const alignment = buildSyntheticElevenLabsAlignment(script);
    const boundaries = convertElevenLabsAlignmentToBoundaries(script, alignment);

    expect(boundaries).toHaveLength(2);

    // "Video" is [0, 5)
    expect(boundaries[0]?.text).toBe("Video");
    expect(boundaries[0]?.textOffset).toBe(0);
    expect(boundaries[0]?.wordLength).toBe(5);

    // "production" starts after "Video" (5) + " " (1) + "🎬" (2) + " " (1) = 9
    expect(boundaries[1]?.text).toBe("production");
    expect(boundaries[1]?.textOffset).toBe(9);
    expect(boundaries[1]?.wordLength).toBe(10);
    expect(script.slice(9, 19)).toBe("production");
  });

  describe("Fail-Closed Alignment Validation", () => {
    const validScript = "Hello world";
    const validAlignment = buildSyntheticElevenLabsAlignment(validScript);

    it("rejects null or non-object alignment", () => {
      expect(() => convertElevenLabsAlignmentToBoundaries(validScript, null)).toThrow(DomainError);
      expect(() => convertElevenLabsAlignmentToBoundaries(validScript, undefined)).toThrow(DomainError);
      expect(() => convertElevenLabsAlignmentToBoundaries(validScript, "string" as never)).toThrow(DomainError);
    });

    it("rejects non-array alignment properties", () => {
      expect(() =>
        convertElevenLabsAlignmentToBoundaries(validScript, {
          characters: "not-an-array",
          character_start_times_seconds: [0.1],
          character_end_times_seconds: [0.2],
        })
      ).toThrow(DomainError);
    });

    it("rejects array length mismatches", () => {
      expect(() =>
        convertElevenLabsAlignmentToBoundaries(validScript, {
          characters: Array.from(validScript),
          character_start_times_seconds: [0.1, 0.2], // short
          character_end_times_seconds: Array.from(validScript).map(() => 0.3),
        })
      ).toThrow(DomainError);
    });

    it("rejects character mismatch against originalScript (missing character)", () => {
      const tamperedAlignment = {
        characters: Array.from("Hello worl"), // missing 'd'
        character_start_times_seconds: Array.from("Hello worl").map((_, i) => i * 0.1),
        character_end_times_seconds: Array.from("Hello worl").map((_, i) => (i + 1) * 0.1),
      };
      expect(() => convertElevenLabsAlignmentToBoundaries(validScript, tamperedAlignment)).toThrow(DomainError);
    });

    it("rejects character mismatch against originalScript (altered character)", () => {
      const tamperedAlignment = {
        characters: Array.from("Hello World"), // Capital 'W' differs from 'w'
        character_start_times_seconds: Array.from(validScript).map((_, i) => i * 0.1),
        character_end_times_seconds: Array.from(validScript).map((_, i) => (i + 1) * 0.1),
      };
      expect(() => convertElevenLabsAlignmentToBoundaries(validScript, tamperedAlignment)).toThrow(DomainError);
    });

    it("rejects non-finite (NaN / Infinity) or negative timestamps", () => {
      const badTimestamps = [NaN, Infinity, -Infinity, -0.5];

      for (const bad of badTimestamps) {
        const startTimes = Array.from(validScript).map((_, i) => (i === 0 ? bad : i * 0.1));
        const endTimes = Array.from(validScript).map((_, i) => (i + 1) * 0.1);

        expect(() =>
          convertElevenLabsAlignmentToBoundaries(validScript, {
            characters: Array.from(validScript),
            character_start_times_seconds: startTimes,
            character_end_times_seconds: endTimes,
          })
        ).toThrow(DomainError);
      }
    });

    it("rejects character end time before start time", () => {
      const startTimes = Array.from(validScript).map((_, i) => i * 0.1);
      const endTimes = Array.from(validScript).map((_, i) => (i === 2 ? 0.05 : (i + 1) * 0.1)); // index 2 starts at 0.2, ends at 0.05

      expect(() =>
        convertElevenLabsAlignmentToBoundaries(validScript, {
          characters: Array.from(validScript),
          character_start_times_seconds: startTimes,
          character_end_times_seconds: endTimes,
        })
      ).toThrow(DomainError);
    });

    it("rejects non-monotonic character start times", () => {
      const startTimes = Array.from(validScript).map((_, i) => (i === 3 ? 0.1 : i * 0.1)); // index 3 goes backwards
      const endTimes = Array.from(validScript).map((_, i) => (i + 1) * 0.1);

      expect(() =>
        convertElevenLabsAlignmentToBoundaries(validScript, {
          characters: Array.from(validScript),
          character_start_times_seconds: startTimes,
          character_end_times_seconds: endTimes,
        })
      ).toThrow(DomainError);
    });
  });
});
