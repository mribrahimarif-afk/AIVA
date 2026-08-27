import { DomainError } from "@/domain/errors";
import { VoiceBoundaryDto, VoiceSynthesisResult } from "./voice.types";
import { ticksToMs } from "./timing";

export const HARD_MAX_AUDIO_BYTES = 104857600; // 100 MB immutable server-side hard maximum

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
 * Validates a complete synthesis result from a VoiceProvider against all TASK-004 local invariants.
 *
 * Invariants enforced:
 * 1. audioData is a non-empty Buffer.
 * 2. audioByteCount <= maxAudioBytes (and <= 100MB hard limit).
 * 3. Total duration comes exclusively from synthesis result audioDurationTicks, is finite, > 0, and <= maxDurationMs.
 * 4. Boundaries order is strictly 1..N.
 * 5. Every boundary source span [sourceStart, sourceEnd) is valid, non-empty, and within originalScript bounds.
 * 6. Transient Azure event.text matches exact originalScript.slice(sourceStart, sourceEnd).
 * 7. Source spans are non-decreasing and non-overlapping.
 * 8. Audio start times are monotonic and within total duration.
 * 9. Word text is reconstructed strictly from originalScript.
 */
export function validateVoiceSynthesis(
  result: VoiceSynthesisResult,
  options: ValidateVoiceSynthesisOptions
): ValidatedVoiceResult {
  const { originalScript, maxDurationMs, maxAudioBytes } = options;

  // 1. Audio data validation
  if (!result.audioData || !Buffer.isBuffer(result.audioData) || result.audioData.length === 0) {
    throw new DomainError("EMPTY_AUDIO", "Voice provider produced empty or missing audio data");
  }

  const audioByteCount = result.audioData.length;
  const effectiveMaxBytes = Math.min(maxAudioBytes, HARD_MAX_AUDIO_BYTES);
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
    result.audioDurationTicks <= 0
  ) {
    throw new DomainError(
      "INVALID_AUDIO_DURATION",
      `Voice provider returned invalid or non-positive audio duration ticks: ${result.audioDurationTicks}`
    );
  }

  const durationMs = ticksToMs(result.audioDurationTicks, "audioDurationTicks");
  if (durationMs <= 0) {
    throw new DomainError(
      "INVALID_AUDIO_DURATION",
      `Voice audio duration (${durationMs} ms) must be greater than zero`
    );
  }

  if (durationMs > maxDurationMs) {
    throw new DomainError(
      "INVALID_AUDIO_DURATION",
      `Voice audio duration (${durationMs} ms) exceeds maximum configured limit (${maxDurationMs} ms)`
    );
  }

  // 3. Word boundary validation and source alignment
  const rawBoundaries = result.boundaries || [];
  const validatedBoundaries: VoiceBoundaryDto[] = [];
  let prevSourceEnd = 0;
  let prevAudioStartMs = 0;

  let i = 0;
  for (const raw of rawBoundaries) {
    if (!raw) continue;
    const order = ++i;

    // Boundary type filter: word boundaries only
    if (raw.boundaryType && raw.boundaryType !== "Word" && raw.boundaryType !== "SpeechSynthesisBoundaryType.Word") {
      continue;
    }

    if (
      typeof raw.textOffset !== "number" ||
      !Number.isInteger(raw.textOffset) ||
      typeof raw.wordLength !== "number" ||
      !Number.isInteger(raw.wordLength) ||
      raw.wordLength <= 0
    ) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary ${order} has invalid textOffset (${raw.textOffset}) or wordLength (${raw.wordLength})`
      );
    }

    const sourceStart = raw.textOffset;
    const sourceEnd = sourceStart + raw.wordLength;

    if (sourceStart < 0 || sourceEnd > originalScript.length || sourceEnd <= sourceStart) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary ${order} span [${sourceStart}, ${sourceEnd}) is out of bounds for script length ${originalScript.length}`
      );
    }

    // Source spans must be non-decreasing and non-overlapping
    if (sourceStart < prevSourceEnd) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary ${order} sourceStart (${sourceStart}) overlaps previous sourceEnd (${prevSourceEnd})`
      );
    }

    // Exact event.text comparison with authoritative source slice (no broad trimming or mutating)
    const exactSourceSlice = originalScript.slice(sourceStart, sourceEnd);
    if (typeof raw.text === "string" && raw.text.length > 0) {
      if (raw.text !== exactSourceSlice) {
        throw new DomainError(
          "WORD_BOUNDARY_ALIGNMENT_FAILED",
          `Boundary ${order} event text mismatch: expected exact source slice '${exactSourceSlice}', received provider text '${raw.text}'`
        );
      }
    }

    // Audio timing validation
    const audioStartMs = ticksToMs(raw.audioOffsetTicks, `boundary[${order}].audioOffsetTicks`);
    const audioDurationMs = ticksToMs(raw.durationTicks, `boundary[${order}].durationTicks`);

    if (audioStartMs < prevAudioStartMs) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary ${order} audioStartMs (${audioStartMs}) is non-monotonic relative to previous (${prevAudioStartMs})`
      );
    }

    if (audioStartMs + audioDurationMs > durationMs) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Boundary ${order} audio end (${audioStartMs + audioDurationMs} ms) exceeds total audio duration (${durationMs} ms)`
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
