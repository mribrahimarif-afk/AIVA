import { describe, it, expect } from "vitest";
import { ticksToMs, TICKS_PER_MILLISECOND } from "@/domain/voice/timing";
import { ValidationError } from "@/domain/errors";

describe("Voice Timing & Ticks-to-Ms Conversion Tests", () => {
  it("converts exact multiples of 10,000 ticks to milliseconds", () => {
    expect(ticksToMs(0)).toBe(0);
    expect(ticksToMs(10000)).toBe(1);
    expect(ticksToMs(100000)).toBe(10);
    expect(ticksToMs(1000000)).toBe(100);
    expect(ticksToMs(10000000)).toBe(1000); // 1 second
    expect(ticksToMs(600000000)).toBe(60000); // 60 seconds
  });

  it("applies deterministic Math.round policy for sub-millisecond tick precision", () => {
    expect(ticksToMs(14999)).toBe(1); // 1.4999 ms -> 1 ms
    expect(ticksToMs(15000)).toBe(2); // 1.5000 ms -> 2 ms
    expect(ticksToMs(15001)).toBe(2); // 1.5001 ms -> 2 ms
    expect(ticksToMs(24999)).toBe(2); // 2.4999 ms -> 2 ms
    expect(ticksToMs(25000)).toBe(3); // 2.5000 ms -> 3 ms
  });

  it("rejects negative tick values with ValidationError", () => {
    expect(() => ticksToMs(-1)).toThrow(ValidationError);
    expect(() => ticksToMs(-10000)).toThrow(ValidationError);
  });

  it("rejects non-finite, NaN, and string inputs with ValidationError", () => {
    expect(() => ticksToMs(NaN)).toThrow(ValidationError);
    expect(() => ticksToMs(Infinity)).toThrow(ValidationError);
    expect(() => ticksToMs(-Infinity)).toThrow(ValidationError);
    expect(() => ticksToMs("10000" as unknown as number)).toThrow(ValidationError);
    expect(() => ticksToMs(null as unknown as number)).toThrow(ValidationError);
    expect(() => ticksToMs(undefined as unknown as number)).toThrow(ValidationError);
  });

  it("rejects values exceeding Number.MAX_SAFE_INTEGER", () => {
    expect(() => ticksToMs(Number.MAX_SAFE_INTEGER + 100)).toThrow(ValidationError);
  });
});
