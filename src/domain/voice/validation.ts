import { DomainError } from "@/domain/errors";
import { VoiceBoundaryDto, VoiceSynthesisResult } from "./voice.types";
import { ticksToMs } from "./timing";

export const HARD_MAX_AUDIO_BYTES = 104857600; // 100 MB immutable server-side hard maximum
export const HARD_MAX_DURATION_MS = 3600000; // 1 hour immutable server-side hard maximum
export const MIN_AUDIO_BYTES = 1024; // 1 KB
export const MIN_DURATION_MS = 1000; // 1 second

export interface ValidateVoiceSynthesisOptions {
  originalScript: string;
  maxDurationMs: number;
  maxAudioBytes: number;
}

export interface ValidatedVoiceResult {
  durationMs: number;
  audioByteCount: number;
  boundaries: VoiceBoundaryDto[];
}

/**
 * Validates and bounds configured maxAudioBytes.
 * Fails closed on NaN, Infinity, negative, zero, fraction, or non-safe integer values.
 */
export function validateMaxAudioBytes(val: unknown): number {
  if (
    typeof val !== "number" ||
    !Number.isFinite(val) ||
    !Number.isSafeInteger(val) ||
    val < MIN_AUDIO_BYTES
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Invalid maxAudioBytes limit: must be a positive safe integer of at least ${MIN_AUDIO_BYTES} bytes`
    );
  }
  return Math.min(val, HARD_MAX_AUDIO_BYTES);
}

/**
 * Validates and bounds configured maxDurationMs.
 * Fails closed on NaN, Infinity, negative, zero, fraction, or non-safe integer values.
 */
export function validateMaxDurationMs(val: unknown): number {
  if (
    typeof val !== "number" ||
    !Number.isFinite(val) ||
    !Number.isSafeInteger(val) ||
    val < MIN_DURATION_MS ||
    val > HARD_MAX_DURATION_MS
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      `Invalid maxDurationMs limit: must be a positive safe integer between ${MIN_DURATION_MS} and ${HARD_MAX_DURATION_MS} ms`
    );
  }
  return val;
}

/**
 * Validates a complete synthesis result from a VoiceProvider against all TASK-004 local invariants.
 *
 * Invariants enforced:
 * 1. audioData is a non-empty Buffer.
 * 2. audioByteCount <= maxAudioBytes (and <= 100MB hard limit).
 * 3. Total duration comes exclusively from synthesis result audioDurationTicks, is finite, > 0, and <= maxDurationMs.
 * 4. Retained WORD boundaries are filtered and numbered contiguously 1..N.
 * 5. Every boundary source span [sourceStart, sourceEnd) is valid, non-empty, and within originalScript bounds.
 * 6. Transient Azure event.text matches exact originalScript.slice(sourceStart, sourceEnd).
 * 7. Source spans are non-decreasing and non-overlapping.
 * 8. Audio start times are monotonic and within total duration.
 * 9. Persisted and returned word text is reconstructed strictly from originalScript.
 * 10. No hostile/raw text, prompt injection, or script text escapes through error messages.
 */
export function validateVoiceSynthesis(
  result: VoiceSynthesisResult,
  options: ValidateVoiceSynthesisOptions
): ValidatedVoiceResult {
  const { originalScript } = options;
  const effectiveMaxBytes = validateMaxAudioBytes(options.maxAudioBytes);
  const effectiveMaxDurationMs = validateMaxDurationMs(options.maxDurationMs);

  // 1. Audio data validation
  if (!result.audioData || !Buffer.isBuffer(result.audioData) || result.audioData.length === 0) {
    throw new DomainError("EMPTY_AUDIO", "Voice provider produced empty or missing audio data");
  }

  const audioByteCount = result.audioData.length;
  if (audioByteCount > effectiveMaxBytes) {
    throw new DomainError(
      "AUDIO_TOO_LARGE",
      `Voice audio size (${audioByteCount} bytes) exceeds maximum limit (${effectiveMaxBytes} bytes)`
    );
  }

  // 2. Authoritative audio duration validation (from synthesis result ticks, not last boundary)
  if (
    typeof result.audioDurationTicks !== "number" ||
    !Number.isFinite(result.audioDurationTicks) ||
    !Number.isSafeInteger(result.audioDurationTicks) ||
    result.audioDurationTicks <= 0
  ) {
    throw new DomainError(
      "INVALID_AUDIO_DURATION",
      "Voice provider returned invalid or non-positive audio duration ticks"
    );
  }

  const durationMs = ticksToMs(result.audioDurationTicks, "audioDurationTicks");
  if (durationMs <= 0) {
    throw new DomainError(
      "INVALID_AUDIO_DURATION",
      `Voice audio duration (${durationMs} ms) must be greater than zero`
    );
  }

  if (durationMs > effectiveMaxDurationMs) {
    throw new DomainError(
      "INVALID_AUDIO_DURATION",
      `Voice audio duration (${durationMs} ms) exceeds maximum configured limit (${effectiveMaxDurationMs} ms)`
    );
  }

  // 3. Word boundary validation and source alignment
  const rawBoundaries = result.boundaries || [];
  const validatedBoundaries: VoiceBoundaryDto[] = [];
  let prevSourceEnd = 0;
  let prevAudioStartMs = 0;

  // Filter word boundaries first
  const wordBoundaries = rawBoundaries.filter((raw) => {
    if (!raw) return false;
    // Retain only word boundaries
    return !raw.boundaryType || raw.boundaryType === "Word" || raw.boundaryType === "SpeechSynthesisBoundaryType.Word";
  });

  let order = 0;
  for (const raw of wordBoundaries) {
    order++;

    if (
      typeof raw.text !== "string" ||
      raw.text.length === 0 ||
      typeof raw.textOffset !== "number" ||
      !Number.isSafeInteger(raw.textOffset) ||
      raw.textOffset < 0 ||
      typeof raw.wordLength !== "number" ||
      !Number.isSafeInteger(raw.wordLength) ||
      raw.wordLength <= 0
    ) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary at index ${order} has invalid textual content, textOffset, or wordLength`
      );
    }

    const sourceStart = raw.textOffset;
    const sourceEnd = sourceStart + raw.wordLength;

    if (sourceStart < 0 || sourceEnd > originalScript.length || sourceEnd <= sourceStart) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary at index ${order} span is out of script bounds`
      );
    }

    // Source spans must be non-decreasing and non-overlapping
    if (sourceStart < prevSourceEnd) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary at index ${order} overlaps with previous word boundary`
      );
    }

    // Exact event.text comparison with authoritative source slice (no broad trimming or mutating)
    const exactSourceSlice = originalScript.slice(sourceStart, sourceEnd);
    if (raw.text !== exactSourceSlice) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary at index ${order} event text does not match exact script slice`
      );
    }

    // Audio timing validation
    const audioStartMs = ticksToMs(raw.audioOffsetTicks, `boundary[${order}].audioOffsetTicks`);
    const audioDurationMs = ticksToMs(raw.durationTicks, `boundary[${order}].durationTicks`);

    if (audioStartMs < prevAudioStartMs) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary at index ${order} audio start time is non-monotonic`
      );
    }

    if (audioStartMs + audioDurationMs > durationMs) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary at index ${order} audio end time exceeds total audio duration`
      );
    }

    validatedBoundaries.push({
      order,
      sourceStart,
      sourceEnd,
      audioStartMs,
      audioDurationMs,
      text: exactSourceSlice, // Authoritative text is derived locally from originalScript
    });

    prevSourceEnd = sourceEnd;
    prevAudioStartMs = audioStartMs;
  }

  return {
    durationMs,
    audioByteCount,
    boundaries: validatedBoundaries,
  };
}
