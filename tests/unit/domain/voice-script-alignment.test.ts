import { describe, it, expect } from "vitest";
import { validateVoiceSynthesis } from "@/domain/voice/validation";
import { RawVoiceBoundary, VoiceSynthesisResult } from "@/domain/voice";

describe("Voice Script Alignment Test Matrix", () => {
  const defaultOptions = {
    maxDurationMs: 600000,
    maxAudioBytes: 67108864,
  };
  const validBuffer = Buffer.from("RIFF....WAVEfmt ....data....");

  function buildBoundariesForScript(script: string): RawVoiceBoundary[] {
    const boundaries: RawVoiceBoundary[] = [];
    const regex = /[\p{L}\p{N}]+/gu;
    let match: RegExpExecArray | null;
    let currentTick = 1000000; // 100 ms

    while ((match = regex.exec(script)) !== null) {
      const wordText = match[0];
      const textOffset = match.index;
      const wordLength = wordText.length;

      boundaries.push({
        text: wordText,
        textOffset,
        wordLength,
        audioOffsetTicks: currentTick,
        durationTicks: 2500000, // 250 ms
        boundaryType: "Word",
      });

      currentTick += 3000000; // 300 ms step
    }

    return boundaries;
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
      name: "7. Emoji between words and adjacent to text",
      script: "Great video 🎬 made with AIVA 🚀✨ now! 💥",
    },
    {
      name: "8. Numbers, apostrophes, and currency symbols",
      script: "It's 100% automated and costs $50 or Rs. 15000 in 2026.",
    },
  ];

  for (const { name, script } of testMatrix) {
    it(`accurately aligns and reconstructs word boundaries for: ${name}`, () => {
      const rawBoundaries = buildBoundariesForScript(script);
      const totalDurationTicks = (rawBoundaries.length * 300 + 500) * 10000;

      const synthesisResult: VoiceSynthesisResult = {
        audioData: validBuffer,
        audioDurationTicks: totalDurationTicks,
        voiceName: "ur-PK-AsadNeural",
        outputFormat: "Riff24Khz16BitMonoPcm",
        boundaries: rawBoundaries,
      };

      const validated = validateVoiceSynthesis(synthesisResult, {
        ...defaultOptions,
        originalScript: script,
      });

      expect(validated.boundaries).toHaveLength(rawBoundaries.length);

      // Verify every reconstructed word text strictly equals originalScript.slice(sourceStart, sourceEnd)
      for (const b of validated.boundaries) {
        const expectedSlice = script.slice(b.sourceStart, b.sourceEnd);
        expect(b.text).toBe(expectedSlice);
        expect(b.sourceStart).toBeGreaterThanOrEqual(0);
        expect(b.sourceEnd).toBeLessThanOrEqual(script.length);
        expect(b.sourceEnd).toBeGreaterThan(b.sourceStart);
      }
    });
  }
});
