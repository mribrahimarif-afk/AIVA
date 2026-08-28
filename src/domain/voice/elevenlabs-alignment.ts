import { DomainError } from "@/domain/errors";
import { RawVoiceBoundary } from "./voice.types";

export interface ElevenLabsAlignment {
  characters?: unknown;
  character_start_times_seconds?: unknown;
  character_end_times_seconds?: unknown;
}

/**
 * Validates ElevenLabs character alignment payload and converts it into
 * deterministic, UTF-16 source-accurate word boundaries matching AIVA's
 * common VoiceBoundary contract.
 *
 * Invariants enforced:
 * 1. alignment is a non-null object with characters, start times, and end times arrays.
 * 2. All 3 arrays have identical lengths.
 * 3. Reconstructed characters string matches originalScript exactly (characters.join("") === originalScript).
 * 4. All timing values are finite, non-negative numbers with end >= start.
 * 5. Audio start timing progresses monotonically.
 * 6. UTF-16 code unit offsets are accurately tracked for multi-byte / surrogate-pair characters (e.g. emoji).
 * 7. Words are segmented using Unicode letter/number tokens (/[\p{L}\p{N}]+/gu).
 * 8. Every boundary's sourceStart and sourceEnd correspond precisely to originalScript.slice(sourceStart, sourceEnd).
 */
export function convertElevenLabsAlignmentToBoundaries(
  originalScript: string,
  alignment: ElevenLabsAlignment | null | undefined
): RawVoiceBoundary[] {
  if (!alignment || typeof alignment !== "object") {
    throw new DomainError("WORD_BOUNDARY_ALIGNMENT_FAILED", "Missing or invalid ElevenLabs alignment object");
  }

  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;

  if (
    !Array.isArray(characters) ||
    !Array.isArray(character_start_times_seconds) ||
    !Array.isArray(character_end_times_seconds)
  ) {
    throw new DomainError("WORD_BOUNDARY_ALIGNMENT_FAILED", "ElevenLabs alignment properties must be arrays");
  }

  const charCount = characters.length;
  if (
    character_start_times_seconds.length !== charCount ||
    character_end_times_seconds.length !== charCount
  ) {
    throw new DomainError(
      "WORD_BOUNDARY_ALIGNMENT_FAILED",
      `ElevenLabs alignment array length mismatch: characters (${charCount}), start_times (${character_start_times_seconds.length}), end_times (${character_end_times_seconds.length})`
    );
  }

  // 1. Script fidelity verification: joined characters must match originalScript exactly
  const reconstructedScript = characters.join("");
  if (reconstructedScript !== originalScript) {
    throw new DomainError(
      "WORD_BOUNDARY_ALIGNMENT_FAILED",
      "ElevenLabs alignment characters do not match exact original script"
    );
  }

  // 2. Validate timing arrays and construct UTF-16 code-unit indexed mapping
  interface CharEntry {
    char: string;
    jsStart: number;
    jsEnd: number;
    startTimeSec: number;
    endTimeSec: number;
  }

  const charEntries: CharEntry[] = new Array(charCount);
  let currentJsOffset = 0;
  let prevStartTime = 0;

  for (let i = 0; i < charCount; i++) {
    const ch = characters[i];
    if (typeof ch !== "string") {
      throw new DomainError("WORD_BOUNDARY_ALIGNMENT_FAILED", `Alignment character at index ${i} is not a string`);
    }

    const start = character_start_times_seconds[i];
    const end = character_end_times_seconds[i];

    if (
      typeof start !== "number" ||
      !Number.isFinite(start) ||
      start < 0 ||
      typeof end !== "number" ||
      !Number.isFinite(end) ||
      end < 0
    ) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Alignment timestamp at index ${i} contains non-finite or negative value`
      );
    }

    if (end < start) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Alignment character at index ${i} has end time (${end}) before start time (${start})`
      );
    }

    if (start < prevStartTime) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Alignment character start time at index ${i} is non-monotonic`
      );
    }

    const jsStart = currentJsOffset;
    const jsEnd = currentJsOffset + ch.length; // UTF-16 length (e.g. 2 for surrogate pairs like 🎬)

    charEntries[i] = {
      char: ch,
      jsStart,
      jsEnd,
      startTimeSec: start,
      endTimeSec: end,
    };

    currentJsOffset = jsEnd;
    prevStartTime = start;
  }

  // 3. Segment originalScript into words using Unicode letters & numbers (/[\p{L}\p{N}]+/gu)
  const boundaries: RawVoiceBoundary[] = [];
  const wordRegex = /[\p{L}\p{N}]+/gu;
  let match: RegExpExecArray | null;

  while ((match = wordRegex.exec(originalScript)) !== null) {
    const wordText = match[0];
    const wordStart = match.index;
    const wordEnd = wordStart + wordText.length;

    // Find character entries spanning [wordStart, wordEnd)
    let firstCharIdx = -1;
    let lastCharIdx = -1;

    for (let i = 0; i < charCount; i++) {
      const entry = charEntries[i]!;
      if (entry.jsStart >= wordStart && entry.jsStart < wordEnd) {
        if (firstCharIdx === -1) {
          firstCharIdx = i;
        }
        lastCharIdx = i;
      }
    }

    if (firstCharIdx === -1 || lastCharIdx === -1) {
      throw new DomainError(
        "WORD_BOUNDARY_ALIGNMENT_FAILED",
        `Could not map word "${wordText}" at [${wordStart}, ${wordEnd}) to character alignment`
      );
    }

    const firstEntry = charEntries[firstCharIdx]!;
    const lastEntry = charEntries[lastCharIdx]!;

    const audioStartSec = firstEntry.startTimeSec;
    const audioEndSec = lastEntry.endTimeSec;

    const audioOffsetTicks = Math.round(audioStartSec * 10_000_000);
    const durationTicks = Math.max(0, Math.round((audioEndSec - audioStartSec) * 10_000_000));

    boundaries.push({
      text: wordText,
      textOffset: wordStart,
      wordLength: wordText.length,
      audioOffsetTicks,
      durationTicks,
      boundaryType: "Word",
    });
  }

  return boundaries;
}
