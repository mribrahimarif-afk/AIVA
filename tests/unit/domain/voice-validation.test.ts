import { describe, it, expect } from "vitest";
import { validateVoiceSynthesis, HARD_MAX_AUDIO_BYTES } from "@/domain/voice/validation";
import { DomainError } from "@/domain/errors";
import { VoiceSynthesisResult } from "@/domain/voice";

describe("Voice Synthesis Validation & Invariants Tests", () => {
  const sampleScript = "Hello world from AIVA";
  const validBuffer = Buffer.from("RIFF....WAVEfmt ....data....");
  const defaultOptions = {
    originalScript: sampleScript,
    maxDurationMs: 600000,
    maxAudioBytes: 67108864,
  };

  it("successfully validates a valid synthesis result", () => {
    const result: VoiceSynthesisResult = {
      audioData: validBuffer,
      audioDurationTicks: 25000000, // 2500 ms
      voiceName: "ur-PK-AsadNeural",
      outputFormat: "Riff24Khz16BitMonoPcm",
      boundaries: [
        {
          text: "Hello",
          textOffset: 0,
          wordLength: 5,
          audioOffsetTicks: 1000000, // 100 ms
          durationTicks: 4000000, // 400 ms
          boundaryType: "Word",
        },
        {
          text: "world",
          textOffset: 6,
          wordLength: 5,
          audioOffsetTicks: 6000000, // 600 ms
          durationTicks: 5000000, // 500 ms
          boundaryType: "Word",
        },
        {
          text: "from",
          textOffset: 12,
          wordLength: 4,
          audioOffsetTicks: 12000000, // 1200 ms
          durationTicks: 3000000, // 300 ms
          boundaryType: "Word",
        },
        {
          text: "AIVA",
          textOffset: 17,
          wordLength: 4,
          audioOffsetTicks: 16000000, // 1600 ms
          durationTicks: 6000000, // 600 ms
          boundaryType: "Word",
        },
      ],
    };

    const validated = validateVoiceSynthesis(result, defaultOptions);
    expect(validated.durationMs).toBe(2500);
    expect(validated.audioByteCount).toBe(validBuffer.length);
    expect(validated.boundaries).toHaveLength(4);
    expect(validated.boundaries[0]?.text).toBe("Hello");
    expect(validated.boundaries[3]?.text).toBe("AIVA");
  });

  it("proves total duration comes from audioDurationTicks, not last word boundary", () => {
    const result: VoiceSynthesisResult = {
      audioData: validBuffer,
      audioDurationTicks: 50000000, // 5000 ms total duration
      voiceName: "ur-PK-AsadNeural",
      outputFormat: "Riff24Khz16BitMonoPcm",
      boundaries: [
        {
          text: "Hello",
          textOffset: 0,
          wordLength: 5,
          audioOffsetTicks: 1000000, // 100 ms
          durationTicks: 4000000, // 400 ms -> ends at 500 ms
          boundaryType: "Word",
        },
      ],
    };

    const validated = validateVoiceSynthesis(result, {
      ...defaultOptions,
      originalScript: "Hello",
    });

    // Duration must be 5000 ms (from audioDurationTicks), NOT 500 ms (last boundary end)
    expect(validated.durationMs).toBe(5000);
  });

  it("rejects empty or missing audio data with EMPTY_AUDIO", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: Buffer.alloc(0),
          audioDurationTicks: 10000000,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [],
        },
        defaultOptions
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("EMPTY_AUDIO");
    }
  });

  it("rejects audio exceeding maxAudioBytes with AUDIO_TOO_LARGE", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: Buffer.alloc(5000),
          audioDurationTicks: 10000000,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [],
        },
        {
          ...defaultOptions,
          maxAudioBytes: 2048, // max is 2048 bytes (>= 1024 min)
        }
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("AUDIO_TOO_LARGE");
    }
  });

  it("enforces immutable server-side hard maximum byte limit (100 MB)", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: Buffer.alloc(HARD_MAX_AUDIO_BYTES + 100),
          audioDurationTicks: 10000000,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [],
        },
        {
          ...defaultOptions,
          maxAudioBytes: 999999999, // Attempts to configure beyond 100MB
        }
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("AUDIO_TOO_LARGE");
    }
  });

  it("rejects non-positive or invalid duration ticks with INVALID_AUDIO_DURATION", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: validBuffer,
          audioDurationTicks: 0,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [],
        },
        defaultOptions
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("INVALID_AUDIO_DURATION");
    }

    try {
      validateVoiceSynthesis(
        {
          audioData: validBuffer,
          audioDurationTicks: -1000,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [],
        },
        defaultOptions
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("INVALID_AUDIO_DURATION");
    }
  });

  it("rejects duration exceeding maxDurationMs with INVALID_AUDIO_DURATION", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: validBuffer,
          audioDurationTicks: 700000000, // 70,000 ms = 70s
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [],
        },
        {
          ...defaultOptions,
          maxDurationMs: 60000, // 60s limit
        }
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("INVALID_AUDIO_DURATION");
    }
  });

  it("rejects overlapping boundary source spans with WORD_BOUNDARY_ALIGNMENT_FAILED", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: validBuffer,
          audioDurationTicks: 10000000,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [
            {
              text: "Hello",
              textOffset: 0,
              wordLength: 5,
              audioOffsetTicks: 1000000,
              durationTicks: 2000000,
              boundaryType: "Word",
            },
            {
              text: "world",
              textOffset: 4, // Overlaps index 4 of "Hello"
              wordLength: 5,
              audioOffsetTicks: 3000000,
              durationTicks: 2000000,
              boundaryType: "Word",
            },
          ],
        },
        defaultOptions
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("WORD_BOUNDARY_ALIGNMENT_FAILED");
    }
  });

  it("rejects out-of-bounds boundary source spans with WORD_BOUNDARY_ALIGNMENT_FAILED", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: validBuffer,
          audioDurationTicks: 10000000,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [
            {
              text: "Hello",
              textOffset: 50, // exceeds script length
              wordLength: 5,
              audioOffsetTicks: 1000000,
              durationTicks: 2000000,
              boundaryType: "Word",
            },
          ],
        },
        defaultOptions
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("WORD_BOUNDARY_ALIGNMENT_FAILED");
    }
  });

  it("rejects boundary event.text mismatch against exact source slice with WORD_BOUNDARY_ALIGNMENT_FAILED", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: validBuffer,
          audioDurationTicks: 10000000,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [
            {
              text: "Goodbye", // Does not match "Hello" at [0, 5)
              textOffset: 0,
              wordLength: 5,
              audioOffsetTicks: 1000000,
              durationTicks: 2000000,
              boundaryType: "Word",
            },
          ],
        },
        defaultOptions
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("WORD_BOUNDARY_ALIGNMENT_FAILED");
    }
  });

  it("rejects non-monotonic audio start times with WORD_BOUNDARY_ALIGNMENT_FAILED", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: validBuffer,
          audioDurationTicks: 10000000,
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [
            {
              text: "Hello",
              textOffset: 0,
              wordLength: 5,
              audioOffsetTicks: 5000000, // 500 ms
              durationTicks: 2000000,
              boundaryType: "Word",
            },
            {
              text: "world",
              textOffset: 6,
              wordLength: 5,
              audioOffsetTicks: 3000000, // 300 ms (decreases!)
              durationTicks: 2000000,
              boundaryType: "Word",
            },
          ],
        },
        defaultOptions
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("WORD_BOUNDARY_ALIGNMENT_FAILED");
    }
  });

  it("rejects boundary audio span exceeding total duration with WORD_BOUNDARY_ALIGNMENT_FAILED", () => {
    try {
      validateVoiceSynthesis(
        {
          audioData: validBuffer,
          audioDurationTicks: 5000000, // 500 ms total duration
          voiceName: "ur-PK-AsadNeural",
          outputFormat: "Riff24Khz16BitMonoPcm",
          boundaries: [
            {
              text: "Hello",
              textOffset: 0,
              wordLength: 5,
              audioOffsetTicks: 4000000, // 400 ms
              durationTicks: 3000000, // 300 ms -> ends at 700 ms > 500 ms
              boundaryType: "Word",
            },
          ],
        },
        defaultOptions
      );
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("WORD_BOUNDARY_ALIGNMENT_FAILED");
    }
  });

  describe("Fail-Closed Resource Limits & Boundary Filtering", () => {
    it("fails closed when maxAudioBytes is NaN, Infinity, negative, zero, fraction, or non-safe integer", () => {
      const invalidValues = [NaN, Infinity, -Infinity, 0, -500, 2.5, 500, Number.MAX_SAFE_INTEGER + 10];
      for (const val of invalidValues) {
        expect(() =>
          validateVoiceSynthesis(
            {
              audioData: validBuffer,
              audioDurationTicks: 10000000,
              voiceName: "ur-PK-AsadNeural",
              outputFormat: "Riff24Khz16BitMonoPcm",
              boundaries: [],
            },
            {
              ...defaultOptions,
              maxAudioBytes: val as number,
            }
          )
        ).toThrow(DomainError);
      }
    });

    it("fails closed when maxDurationMs is NaN, Infinity, negative, zero, fraction, or above hard limit", () => {
      const invalidValues = [NaN, Infinity, -Infinity, 0, -1000, 1.5, 500, 999999999, Number.MAX_SAFE_INTEGER + 10];
      for (const val of invalidValues) {
        expect(() =>
          validateVoiceSynthesis(
            {
              audioData: validBuffer,
              audioDurationTicks: 10000000,
              voiceName: "ur-PK-AsadNeural",
              outputFormat: "Riff24Khz16BitMonoPcm",
              boundaries: [],
            },
            {
              ...defaultOptions,
              maxDurationMs: val as number,
            }
          )
        ).toThrow(DomainError);
      }
    });

    it("filters out non-Word boundaries and numbers retained Word boundaries strictly contiguously (1..N)", () => {
      const result: VoiceSynthesisResult = {
        audioData: validBuffer,
        audioDurationTicks: 25000000, // 2500 ms
        voiceName: "ur-PK-AsadNeural",
        outputFormat: "Riff24Khz16BitMonoPcm",
        boundaries: [
          {
            text: "Hello",
            textOffset: 0,
            wordLength: 5,
            audioOffsetTicks: 1000000,
            durationTicks: 4000000,
            boundaryType: "Word",
          },
          {
            text: " ",
            textOffset: 5,
            wordLength: 1,
            audioOffsetTicks: 5000000,
            durationTicks: 1000000,
            boundaryType: "Punctuation" as never, // Non-word boundary
          },
          {
            text: "world",
            textOffset: 6,
            wordLength: 5,
            audioOffsetTicks: 6000000,
            durationTicks: 5000000,
            boundaryType: "Word",
          },
        ],
      };

      const validated = validateVoiceSynthesis(result, defaultOptions);
      expect(validated.boundaries).toHaveLength(2);
      expect(validated.boundaries[0]?.order).toBe(1);
      expect(validated.boundaries[0]?.text).toBe("Hello");
      expect(validated.boundaries[1]?.order).toBe(2);
      expect(validated.boundaries[1]?.text).toBe("world");
    });

    it("sanitizes error messages so no hostile prompt-injection or raw script text leaks", () => {
      const hostileScript = "CANARY_SECRET_TOKEN_DO_NOT_LEAK";
      const hostileResult: VoiceSynthesisResult = {
        audioData: validBuffer,
        audioDurationTicks: 10000000,
        voiceName: "ur-PK-AsadNeural",
        outputFormat: "Riff24Khz16BitMonoPcm",
        boundaries: [
          {
            text: "HOSTILE_MISMATCH_TEXT_TOKEN",
            textOffset: 0,
            wordLength: hostileScript.length,
            audioOffsetTicks: 1000000,
            durationTicks: 2000000,
            boundaryType: "Word",
          },
        ],
      };

      try {
        validateVoiceSynthesis(hostileResult, {
          ...defaultOptions,
          originalScript: hostileScript,
        });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(DomainError);
        const domainErr = err as DomainError;
        expect(domainErr.message).not.toContain("CANARY_SECRET_TOKEN_DO_NOT_LEAK");
        expect(domainErr.message).not.toContain("HOSTILE_MISMATCH_TEXT_TOKEN");
      }
    });
  });
});
