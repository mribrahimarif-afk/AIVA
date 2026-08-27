import { describe, it, expect } from "vitest";
import { unitizeScript } from "@/domain/director/unitizer";
import { validateAndReconstructPlan } from "@/domain/director/validation";
import type { RawDirectorOutput } from "@/domain/director/director.types";

describe("DirectorPlan Validation & 10 Coverage Invariants", () => {
  const originalScript =
    "Unleash the ultimate audio experience. Powered by quantum drivers. Get yours now.";
  const units = unitizeScript(originalScript);

  const createValidRawPlan = (): RawDirectorOutput => ({
    language: "ENGLISH",
    contentType: "ADVERTISEMENT",
    summary: "High energy commercial highlighting quantum driver sound.",
    creativeDirection: "Modern cyberpunk visuals with deep contrast.",
    scenes: [
      {
        order: 1,
        unitIds: ["u0001"],
        purpose: "HOOK",
        visualBrief: "Close up of headphones illuminating in dark setting.",
        visualSourceHint: "PRODUCT_LIBRARY",
        shotType: "PRODUCT_HERO",
        mood: "Atmospheric",
        setting: "Dark studio",
        subject: "Headphones",
        productPresence: "REQUIRED",
        searchQuery: "headphones product hero studio",
        keywords: ["headphones", "audio"],
        manualAiPrompt: null,
      },
      {
        order: 2,
        unitIds: ["u0002"],
        purpose: "DEMONSTRATION",
        visualBrief: "Futuristic visual showing soundwaves emitting from quantum driver.",
        visualSourceHint: "MANUAL_AI",
        shotType: "ABSTRACT",
        mood: "Futuristic",
        setting: "Abstract sound dimension",
        subject: "Quantum soundwave",
        productPresence: "NOT_NEEDED",
        searchQuery: "soundwave kinetic energy",
        keywords: ["soundwave", "quantum"],
        manualAiPrompt:
          "Futuristic sound wave pulses expanding in 3D space with neon cyan particles and slow motion camera orbit, 4k cinematic render.",
      },
      {
        order: 3,
        unitIds: ["u0003"],
        purpose: "CTA",
        visualBrief: "End card with logo and call to action button.",
        visualSourceHint: "STOCK",
        shotType: "TEXT_GRAPHIC",
        mood: "Decisive",
        setting: "Clean minimalist background",
        subject: "Brand Logo",
        productPresence: "PREFERRED",
        searchQuery: "minimalist call to action end screen",
        keywords: ["cta", "endcard"],
        manualAiPrompt: null,
      },
    ],
  });

  it("validates and reconstructs a completely valid scene plan", () => {
    const raw = createValidRawPlan();
    const result = validateAndReconstructPlan(raw, units, originalScript);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.scenes).toBeDefined();
    expect(result.scenes).toHaveLength(3);

    // Verify reconstructed narration matches original units exactly
    expect(result.scenes![0]?.text).toBe(units[0]?.text);
    expect(result.scenes![1]?.text).toBe(units[1]?.text);
    expect(result.scenes![2]?.text).toBe(units[2]?.text);

    // Verify recombined script equals original
    const recombined = result.scenes!.map((s) => s.text).join("");
    expect(recombined).toBe(originalScript);
  });

  it("rejects plan with missing ScriptUnits", () => {
    const raw = createValidRawPlan();
    // Drop scene 3 (u0003 missing)
    raw.scenes = raw.scenes.slice(0, 2);

    const result = validateAndReconstructPlan(raw, units, originalScript);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("Missing unit"))).toBe(true);
  });

  it("rejects plan with duplicate ScriptUnits", () => {
    const raw = createValidRawPlan();
    raw.scenes[1]!.unitIds = ["u0001", "u0002"]; // u0001 duplicated

    const result = validateAndReconstructPlan(raw, units, originalScript);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicated"))).toBe(true);
  });

  it("rejects plan with unknown unit IDs", () => {
    const raw = createValidRawPlan();
    raw.scenes[0]!.unitIds = ["u9999"];

    const result = validateAndReconstructPlan(raw, units, originalScript);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown unit ID"))).toBe(true);
  });

  it("rejects non-contiguous unit ordering inside a scene", () => {
    const multiUnits = unitizeScript(
      "Sentence one. Sentence two. Sentence three. Sentence four."
    );
    const raw = createValidRawPlan();
    raw.scenes = [
      {
        order: 1,
        unitIds: ["u0001", "u0003"], // Jumps over u0002
        purpose: "HOOK",
        visualBrief: "Opening hero visual showing initial hook.",
        visualSourceHint: "STOCK",
        shotType: "LIFESTYLE",
        mood: "Energetic",
        setting: "City street",
        subject: "Person",
        productPresence: "PREFERRED",
        searchQuery: "city lifestyle",
        keywords: ["city", "lifestyle"],
        manualAiPrompt: null,
      },
      {
        order: 2,
        unitIds: ["u0002", "u0004"],
        purpose: "CTA",
        visualBrief: "Closing visual showing call to action resolution.",
        visualSourceHint: "STOCK",
        shotType: "LIFESTYLE",
        mood: "Energetic",
        setting: "City street",
        subject: "Person",
        productPresence: "PREFERRED",
        searchQuery: "city lifestyle",
        keywords: ["city", "lifestyle"],
        manualAiPrompt: null,
      },
    ];

    const result = validateAndReconstructPlan(
      raw,
      multiUnits,
      "Sentence one. Sentence two. Sentence three. Sentence four."
    );
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("not contiguous"))).toBe(true);
  });

  it("rejects non-contiguous scene ordering (e.g. 1, 3)", () => {
    const raw = createValidRawPlan();
    raw.scenes[1]!.order = 3; // Jump from 1 to 3
    raw.scenes[2]!.order = 4;

    const result = validateAndReconstructPlan(raw, units, originalScript);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("Scene order non-contiguous"))).toBe(true);
  });

  it("rejects empty scenes with 0 unitIds", () => {
    const raw = createValidRawPlan();
    raw.scenes[0]!.unitIds = [];

    const result = validateAndReconstructPlan(raw, units, originalScript);
    expect(result.success).toBe(false);
    expect(
      result.errors.some(
        (e) => e.includes("unitIds") || e.includes("no unitIds") || e.includes("at least 1")
      )
    ).toBe(true);
  });

  it("enforces real product packaging rule (productPresence REQUIRED cannot use MANUAL_AI)", () => {
    const raw = createValidRawPlan();
    raw.scenes[0]!.productPresence = "REQUIRED";
    raw.scenes[0]!.visualSourceHint = "MANUAL_AI";
    raw.scenes[0]!.manualAiPrompt = "An AI generated bottle with exact real logo";

    const result = validateAndReconstructPlan(raw, units, originalScript);
    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("Real product packaging is required (productPresence=REQUIRED)")
      )
    ).toBe(true);
  });

  it("enforces MANUAL_AI cross-field rule (requires manualAiPrompt)", () => {
    const raw = createValidRawPlan();
    raw.scenes[1]!.visualSourceHint = "MANUAL_AI";
    raw.scenes[1]!.manualAiPrompt = null; // Missing prompt

    const result = validateAndReconstructPlan(raw, units, originalScript);
    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("visualSourceHint is MANUAL_AI but manualAiPrompt is missing")
      )
    ).toBe(true);
  });

  it("enforces non-MANUAL_AI cross-field rule (manualAiPrompt must be null)", () => {
    const raw = createValidRawPlan();
    raw.scenes[0]!.visualSourceHint = "STOCK";
    raw.scenes[0]!.manualAiPrompt = "Unnecessary AI prompt provided for stock";

    const result = validateAndReconstructPlan(raw, units, originalScript);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.includes("manualAiPrompt must be null"))).toBe(
      true
    );
  });
});
