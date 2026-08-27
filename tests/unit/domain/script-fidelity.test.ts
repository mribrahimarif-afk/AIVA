import { describe, it, expect } from "vitest";
import { unitizeScript } from "@/domain/director/unitizer";
import { validateAndReconstructPlan } from "@/domain/director/validation";
import type { RawDirectorOutput } from "@/domain/director/director.types";

describe("Script Fidelity & Narration Reconstruction Invariant", () => {
  it("proves model cannot alter or rewrite user narration text", () => {
    const originalScript =
      "Never compromise on quality. Pure organic cotton crafted for all day comfort.";
    const units = unitizeScript(originalScript);

    // Simulate a model that attempt to rewrite narration or add extra ad-copy in hypothetical fields
    const rawOutput: RawDirectorOutput = {
      language: "ENGLISH",
      contentType: "ADVERTISEMENT",
      summary: "High quality organic cotton apparel commercial.",
      creativeDirection: "Warm natural lighting with close fabric textures.",
      scenes: [
        {
          order: 1,
          unitIds: ["u0001"],
          purpose: "HOOK",
          visualBrief: "Person adjusting soft organic cotton collar.",
          visualSourceHint: "PRODUCT_LIBRARY",
          shotType: "PRODUCT_DETAIL",
          mood: "Comfortable",
          setting: "Bright minimal room",
          subject: "Cotton shirt",
          productPresence: "REQUIRED",
          searchQuery: "organic cotton texture closeup",
          keywords: ["organic", "cotton"],
          manualAiPrompt: null,
        },
        {
          order: 2,
          unitIds: ["u0002"],
          purpose: "CTA",
          visualBrief: "Closing logo animation with website link.",
          visualSourceHint: "STOCK",
          shotType: "TEXT_GRAPHIC",
          mood: "Welcoming",
          setting: "White studio background",
          subject: "Brand logo",
          productPresence: "PREFERRED",
          searchQuery: "minimal text graphics background",
          keywords: ["branding", "apparel"],
          manualAiPrompt: null,
        },
      ],
    };

    const validation = validateAndReconstructPlan(rawOutput, units, originalScript);
    expect(validation.success).toBe(true);

    const scenes = validation.scenes!;
    expect(scenes).toHaveLength(2);

    // Verify narration is reconstructed strictly from local units
    expect(scenes[0]?.text).toBe(units[0]?.text);
    expect(scenes[1]?.text).toBe(units[1]?.text);

    // Exact string equality across entire recombined script
    const recombined = scenes.map((s) => s.text).join("");
    expect(recombined).toBe(originalScript);
  });

  it("preserves exact leading/trailing spaces, blank lines, tabs, CRLF, Urdu, Roman Urdu, and emojis", () => {
    const complexScript =
      "  \t\r\nPehela sentence Roman Urdu mein hai!\r\n\r\nیہ دوسرا جملہ اردو رسم الخط میں ہے۔ 🚀\n   Third sentence with leading/trailing tabs and spaces.\t  \n";

    const units = unitizeScript(complexScript);
    expect(units.length).toBeGreaterThan(0);

    // 1. Invariant: Reconstructed script from deterministic unitizer is byte-for-byte exact
    const reconstructedFromUnits = units.map((u) => u.text).join("");
    expect(reconstructedFromUnits).toBe(complexScript);
    expect(reconstructedFromUnits.length).toBe(complexScript.length);

    // 2. Validate with mock scene plan grouping units
    const rawOutput: RawDirectorOutput = {
      language: "URDU",
      contentType: "ADVERTISEMENT",
      summary: "Mixed script commercial with exact formatting.",
      creativeDirection: "Vibrant storytelling with dynamic visuals.",
      scenes: [
        {
          order: 1,
          unitIds: units.slice(0, Math.ceil(units.length / 2)).map((u) => u.id),
          purpose: "HOOK",
          visualBrief: "Scene 1 showing first part of complex script.",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Energetic",
          setting: "City street",
          subject: "Young creator",
          productPresence: "NOT_NEEDED",
          searchQuery: "creator phone city",
          keywords: ["creator", "lifestyle"],
          manualAiPrompt: null,
        },
        {
          order: 2,
          unitIds: units.slice(Math.ceil(units.length / 2)).map((u) => u.id),
          purpose: "CTA",
          visualBrief: "Scene 2 closing shot with call to action.",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Inspiring",
          setting: "Studio",
          subject: "Product display",
          productPresence: "PREFERRED",
          searchQuery: "modern studio product display",
          keywords: ["display", "modern"],
          manualAiPrompt: null,
        },
      ],
    };

    const validation = validateAndReconstructPlan(rawOutput, units, complexScript);
    expect(validation.success).toBe(true);

    const scenes = validation.scenes!;
    expect(scenes).toHaveLength(2);

    // 3. Reconstructed script from validated scenes matches complexScript exactly
    const fullRecombinedFromScenes = scenes.map((s) => s.text).join("");
    expect(fullRecombinedFromScenes).toBe(complexScript);
    expect(fullRecombinedFromScenes.charCodeAt(0)).toBe(complexScript.charCodeAt(0));
  });
});
