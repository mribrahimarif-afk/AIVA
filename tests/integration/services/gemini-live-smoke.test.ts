import { describe, it, expect } from "vitest";
import { GeminiDirectorProvider } from "@/providers/ai/gemini-director.provider";
import { unitizeScript } from "@/domain/director/unitizer";
import { validateAndReconstructPlan } from "@/domain/director/validation";

const hasApiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);

describe("Gemini Live API Smoke Test (Optional Local Only)", () => {
  it.skipIf(!hasApiKey)(
    "runs a minimal live Gemini Director analysis when GEMINI_API_KEY is present locally",
    async () => {
      const provider = new GeminiDirectorProvider({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || "gemini-3.7-flash",
      });

      const tinyScript = "Taste the freshness. Real fruit juice.";
      const units = unitizeScript(tinyScript);

      const rawOutput = await provider.analyze({
        scriptUnits: units,
      });

      expect(rawOutput).toBeDefined();
      expect(rawOutput.scenes.length).toBeGreaterThanOrEqual(1);

      const validation = validateAndReconstructPlan(rawOutput, units, tinyScript);
      expect(validation.success).toBe(true);
      expect(validation.scenes!.map((s) => s.text).join("")).toBe(tinyScript);
    }
  );
});
