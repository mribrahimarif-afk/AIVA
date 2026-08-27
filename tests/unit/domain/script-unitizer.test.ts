import { describe, it, expect } from "vitest";
import {
  unitizeScript,
  reconstructScript,
  UNITIZER_VERSION,
} from "@/domain/director/unitizer";

describe("ScriptUnitizer Domain Unit Tests", () => {
  it("exports the expected UNITIZER_VERSION constant", () => {
    expect(UNITIZER_VERSION).toBe("1");
  });

  it("handles empty script and whitespace-only gracefully", () => {
    expect(unitizeScript("")).toEqual([]);
  });

  it("unitizes a single English sentence with exact reconstruction", () => {
    const script = "Experience the next generation of sound with Aura Audio.";
    const units = unitizeScript(script);

    expect(units.length).toBe(1);
    expect(units[0]?.id).toBe("u0001");
    expect(units[0]?.order).toBe(1);
    expect(units[0]?.sourceStart).toBe(0);
    expect(units[0]?.sourceEnd).toBe(script.length);
    expect(units[0]?.text).toBe(script);
    expect(reconstructScript(units)).toBe(script);
  });

  it("unitizes multiple sentences preserving punctuation and spacing", () => {
    const script =
      "Are you ready for better sound? Discover AuraPod Max. Engineered for pure clarity! Get yours today.";
    const units = unitizeScript(script);

    expect(units.length).toBeGreaterThanOrEqual(3);
    expect(reconstructScript(units)).toBe(script);

    // Verify half-open continuity
    for (let i = 0; i < units.length - 1; i++) {
      expect(units[i]?.sourceEnd).toBe(units[i + 1]?.sourceStart);
      expect(units[i]?.order).toBe(i + 1);
      expect(units[i]?.id).toBe(`u${String(i + 1).padStart(4, "0")}`);
    }
  });

  it("unitizes Urdu Unicode text with Urdu full stop (۔) and Urdu question mark (؟)", () => {
    const script =
      "کیا آپ معیاری آواز کے متلاشی ہیں؟ اورا آڈیو پیش کرتا ہے بے مثال تجربہ۔ آج ہی آرڈر کریں۔";
    const units = unitizeScript(script);

    expect(units.length).toBeGreaterThanOrEqual(2);
    expect(reconstructScript(units)).toBe(script);

    for (let i = 0; i < units.length - 1; i++) {
      expect(units[i]?.sourceEnd).toBe(units[i + 1]?.sourceStart);
    }
  });

  it("unitizes Roman Urdu scripts accurately", () => {
    const script =
      "Kya aap behtareen sound chahte hain? AuraPod Max ke sath music ka asli maza lein. Abhi order karein!";
    const units = unitizeScript(script);

    expect(units.length).toBeGreaterThanOrEqual(2);
    expect(reconstructScript(units)).toBe(script);
  });

  it("handles complex paragraph breaks, multiline formatting, and quotes", () => {
    const script = `Line 1: "Hello world!"\n\nLine 2: Next paragraph starts here.\nLine 3: Another immediate line.`;
    const units = unitizeScript(script);

    expect(units.length).toBeGreaterThan(1);
    expect(reconstructScript(units)).toBe(script);
  });

  it("preserves emojis and complex Unicode characters without corruption", () => {
    const script =
      "🔥 Unleash powerful bass 🎧! Designed for true audiophiles ✨. Grab yours now 🚀!";
    const units = unitizeScript(script);

    expect(units.length).toBeGreaterThanOrEqual(2);
    expect(reconstructScript(units)).toBe(script);
  });

  it("splits very long unpunctuated text into bounded chunks without losing characters", () => {
    const longText =
      "This is a very long commercial voiceover without any punctuation marks that goes on and on describing every single feature and aspect of the revolutionary product in great detail so customers understand why they need to buy it immediately before the special offer expires";
    const units = unitizeScript(longText);

    expect(units.length).toBeGreaterThan(1);
    expect(reconstructScript(units)).toBe(longText);

    for (let i = 0; i < units.length - 1; i++) {
      expect(units[i]?.sourceEnd).toBe(units[i + 1]?.sourceStart);
    }
  });
});
