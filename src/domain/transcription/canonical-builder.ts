import { ValidationError } from "@/domain/errors";
import type { RawTranscriptionWord, TranscriptionWord } from "./transcription.types";

export interface CanonicalReconstructionResult {
  canonicalText: string;
  words: TranscriptionWord[];
}

/**
 * Deterministically constructs a canonical transcript from an accepted sequence of timed words.
 *
 * Requirements:
 * 1. canonicalText is constructed by joining word texts with a single space (" ").
 * 2. Each word receives exact UTF-16 sourceStart and sourceEnd offsets.
 * 3. Enforces the strict invariant: canonicalText.slice(word.sourceStart, word.sourceEnd) === word.text.
 * 4. Preserves all characters, punctuation, and Unicode in word.text without inventing or modifying tokens.
 */
export function buildCanonicalTranscript(
  rawWords: RawTranscriptionWord[]
): CanonicalReconstructionResult {
  if (!rawWords || rawWords.length === 0) {
    return {
      canonicalText: "",
      words: [],
    };
  }

  const words: TranscriptionWord[] = [];
  let currentOffset = 0;
  const textParts: string[] = [];

  for (let i = 0; i < rawWords.length; i++) {
    const rawWord = rawWords[i];
    if (!rawWord) continue;
    const text = rawWord.text.trim();

    if (!text) {
      throw new ValidationError(`Encountered empty word token at index ${i}`);
    }

    if (i > 0) {
      currentOffset += 1; // space character
    }

    const sourceStart = currentOffset;
    const sourceEnd = sourceStart + text.length;
    currentOffset = sourceEnd;

    textParts.push(text);

    words.push({
      sequence: i + 1,
      text,
      startMs: rawWord.startMs,
      endMs: rawWord.endMs,
      sourceStart,
      sourceEnd,
      speaker: rawWord.speaker ?? null,
      confidence: rawWord.confidence ?? null,
      locale: rawWord.locale ?? null,
    });
  }

  const canonicalText = textParts.join(" ");

  // Validate the canonical slice invariant on 100% of words
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    const slice = canonicalText.slice(word.sourceStart, word.sourceEnd);
    if (slice !== word.text) {
      throw new ValidationError(
        `Canonical transcript invariant violation at word ${i + 1} ("${word.text}"): expected "${word.text}", got slice "${slice}"`
      );
    }
  }

  return {
    canonicalText,
    words,
  };
}
