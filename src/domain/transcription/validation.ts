import { ValidationError } from "@/domain/errors";
import type { RawTranscriptionWord, TranscriptionWord } from "./transcription.types";

export const MAX_AUDIO_DURATION_MS = 30 * 60 * 1000; // 30 minutes hard limit for TASK-004B

export interface WordSequenceValidationResult {
  valid: boolean;
  errors: string[];
  durationMs: number;
}

/**
 * Validates a sequence of raw or normalized transcription words against timing invariants.
 */
export function validateTranscriptionWords(
  words: (RawTranscriptionWord | TranscriptionWord)[],
  options: { maxDurationMs?: number; allowEmpty?: boolean } = {}
): WordSequenceValidationResult {
  const { maxDurationMs = MAX_AUDIO_DURATION_MS, allowEmpty = false } = options;
  const errors: string[] = [];

  if (!words || words.length === 0) {
    if (!allowEmpty) {
      errors.push("Transcription words array cannot be empty when speech is detected");
    }
    return {
      valid: errors.length === 0,
      errors,
      durationMs: 0,
    };
  }

  let lastStartMs = 0;
  let maxEndMs = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w) continue;

    if (!w.text || typeof w.text !== "string" || w.text.trim().length === 0) {
      errors.push(`Word at index ${i} has empty or missing text`);
    }

    if (!Number.isFinite(w.startMs) || Number.isNaN(w.startMs)) {
      errors.push(`Word at index ${i} ("${w.text}") has non-finite startMs: ${w.startMs}`);
    }

    if (!Number.isFinite(w.endMs) || Number.isNaN(w.endMs)) {
      errors.push(`Word at index ${i} ("${w.text}") has non-finite endMs: ${w.endMs}`);
    }

    if (w.startMs < 0) {
      errors.push(`Word at index ${i} ("${w.text}") has negative startMs: ${w.startMs}`);
    }

    if (w.endMs < w.startMs) {
      errors.push(
        `Word at index ${i} ("${w.text}") has endMs (${w.endMs}) before startMs (${w.startMs})`
      );
    }

    if (w.startMs < lastStartMs) {
      errors.push(
        `Word at index ${i} ("${w.text}") violates monotonic start ordering: ${w.startMs} < ${lastStartMs}`
      );
    }

    lastStartMs = w.startMs;
    if (w.endMs > maxEndMs) {
      maxEndMs = w.endMs;
    }
  }

  if (maxEndMs > maxDurationMs) {
    errors.push(
      `Transcription end time (${maxEndMs} ms) exceeds the maximum allowed ceiling of ${maxDurationMs} ms (30 minutes)`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    durationMs: maxEndMs,
  };
}

export function assertValidTranscriptionWords(
  words: (RawTranscriptionWord | TranscriptionWord)[],
  options: { maxDurationMs?: number; allowEmpty?: boolean } = {}
): void {
  const result = validateTranscriptionWords(words, options);
  if (!result.valid) {
    throw new ValidationError(
      `Transcription word timing validation failed:\n${result.errors.join("\n")}`,
      { errors: result.errors }
    );
  }
}
