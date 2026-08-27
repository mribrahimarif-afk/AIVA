import { ValidationError } from "@/domain/errors";

export const TICKS_PER_MILLISECOND = 10000;

/**
 * Converts Azure Speech 100-nanosecond ticks to integer milliseconds.
 *
 * Validation policy:
 * - Must be a finite number
 * - Must not be NaN
 * - Must be non-negative (>= 0)
 * - Safe numeric range (within Number.MAX_SAFE_INTEGER)
 *
 * Deterministic rounding: Math.round(ticks / 10000)
 */
export function ticksToMs(ticks: number, fieldName = "ticks"): number {
  if (typeof ticks !== "number" || !Number.isFinite(ticks) || Number.isNaN(ticks)) {
    throw new ValidationError(`Invalid ${fieldName}: must be a finite number, received ${ticks}`);
  }

  if (ticks < 0) {
    throw new ValidationError(`Invalid ${fieldName}: must be non-negative, received ${ticks}`);
  }

  if (ticks > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError(`Invalid ${fieldName}: exceeds safe integer range, received ${ticks}`);
  }

  return Math.round(ticks / TICKS_PER_MILLISECOND);
}
