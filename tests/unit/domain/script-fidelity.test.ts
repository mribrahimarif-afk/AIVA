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
});
