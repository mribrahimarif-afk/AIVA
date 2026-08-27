import { describe, it, expect } from "vitest";
import { OpenRouterDirectorProvider } from "@/providers/ai/openrouter-director.provider";
import { unitizeScript } from "@/domain/director/unitizer";
import { validateAndReconstructPlan } from "@/domain/director/validation";

const hasOpenRouterKey = Boolean(
  process.env.OPENROUTER_API_KEY &&
    process.env.OPENROUTER_API_KEY.trim().length > 0 &&
    process.env.RUN_LIVE_TESTS === "true"
);

describe("OpenRouter Live API Smoke Test (Opt-in)", () => {
  it.skipIf(!hasOpenRouterKey)(
    "runs a minimal live OpenRouter MiniMax analysis when OPENROUTER_API_KEY is present and opt-in is enabled",
    async () => {
      const provider = new OpenRouterDirectorProvider({
        apiKey: process.env.OPENROUTER_API_KEY,
        model: process.env.OPENROUTER_DIRECTOR_MODEL || "minimax/minimax-m3:free",
      });

      const tinyScript = "Yeh naya smart speaker zabardast sound aur lambi battery life ke sath aata hai.";
      const units = unitizeScript(tinyScript);

      const startTime = Date.now();
      const rawOutput = await provider.analyze({
        scriptUnits: units,
      });
      const latencyMs = Date.now() - startTime;

      expect(rawOutput).toBeDefined();
      expect(rawOutput.scenes.length).toBeGreaterThanOrEqual(1);

      const validation = validateAndReconstructPlan(rawOutput, units, tinyScript);
      expect(validation.success).toBe(true);
      expect(validation.scenes!.map((s) => s.text).join("")).toBe(tinyScript);
      expect(rawOutput.model).toBe("minimax/minimax-m3:free");
      console.log(`[OpenRouter Live Smoke] Success: ${rawOutput.model}, Scenes: ${rawOutput.scenes.length}, Latency: ${latencyMs}ms`);
    },
    60000
  );
});
