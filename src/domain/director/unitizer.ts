export const UNITIZER_VERSION = "1";

export interface ScriptUnit {
  readonly id: string;
  readonly order: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly text: string;
}

/**
 * Deterministically splits a script into contiguous ScriptUnits.
 * 
 * Invariants:
 * 1. Every character of the input script belongs to exactly one unit.
 * 2. Units are strictly contiguous: unit[i].sourceEnd === unit[i+1].sourceStart.
 * 3. unit[0].sourceStart === 0, unit[last].sourceEnd === script.length.
 * 4. reconstructScript(unitizeScript(script)) === script.
 */
export function unitizeScript(script: string): ScriptUnit[] {
  if (!script || script.length === 0) {
    return [];
  }

  const length = script.length;
  const breakPoints: number[] = [0];

  const sentenceTerminators = /[.!?\u06D4\u061F]/;
  const maxChunkChars = 140;

  let currentStart = 0;
  let i = 0;

  while (i < length) {
    const char = script[i] ?? "";
    const nextChar = i + 1 < length ? script[i + 1] ?? "" : "";

    // 1. Check for newline boundaries
    if (char === "\n" || (char === "\r" && nextChar === "\n")) {
      const breakIdx = char === "\r" ? i + 2 : i + 1;
      if (breakIdx > currentStart && breakIdx < length) {
        breakPoints.push(breakIdx);
        currentStart = breakIdx;
        i = breakIdx;
        continue;
      }
    }

    // 2. Check for sentence terminators
    if (char && sentenceTerminators.test(char)) {
      // Include any trailing quotes, brackets, or immediately following whitespace in the boundary
      let breakIdx = i + 1;
      while (
        breakIdx < length &&
        (script[breakIdx] === '"' ||
          script[breakIdx] === "'" ||
          script[breakIdx] === "”" ||
          script[breakIdx] === "’" ||
          script[breakIdx] === ")" ||
          script[breakIdx] === "]" ||
          script[breakIdx] === "}")
      ) {
        breakIdx++;
      }
      // Consume trailing whitespace up to next word/character
      while (
        breakIdx < length &&
        (script[breakIdx] === " " || script[breakIdx] === "\t")
      ) {
        breakIdx++;
      }

      if (breakIdx > currentStart && breakIdx < length) {
        breakPoints.push(breakIdx);
        currentStart = breakIdx;
        i = breakIdx;
        continue;
      }
    }

    // 3. Fallback for long unpunctuated text
    if (i - currentStart >= maxChunkChars) {
      // Find the nearest whitespace in the window
      let spaceIdx = -1;
      for (let s = i; s > currentStart + 30; s--) {
        if (script[s] === " " || script[s] === "\t" || script[s] === "\n") {
          spaceIdx = s + 1;
          break;
        }
      }

      const fallbackBreak = spaceIdx > currentStart ? spaceIdx : i;
      if (fallbackBreak > currentStart && fallbackBreak < length) {
        breakPoints.push(fallbackBreak);
        currentStart = fallbackBreak;
        i = fallbackBreak;
        continue;
      }
    }

    i++;
  }

  // Ensure end of string is the final boundary
  if (breakPoints[breakPoints.length - 1] !== length) {
    breakPoints.push(length);
  }

  const units: ScriptUnit[] = [];
  for (let u = 0; u < breakPoints.length - 1; u++) {
    const start = breakPoints[u] ?? 0;
    const end = breakPoints[u + 1] ?? length;
    const unitOrder = u + 1;
    const unitId = `u${String(unitOrder).padStart(4, "0")}`;
    const text = script.slice(start, end);

    units.push({
      id: unitId,
      order: unitOrder,
      sourceStart: start,
      sourceEnd: end,
      text,
    });
  }

  return units;
}

/**
 * Reconstructs original script text from ordered ScriptUnits.
 */
export function reconstructScript(units: readonly ScriptUnit[]): string {
  return units.map((u) => u.text).join("");
}
