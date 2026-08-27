import { describe, it, expect, vi } from "vitest";
import { GeminiDirectorProvider } from "@/providers/ai/gemini-director.provider";
import { ProviderError } from "@/domain/errors";
import { unitizeScript } from "@/domain/director/unitizer";

describe("GeminiDirectorProvider Unit & Error Handling Tests", () => {
  const units = unitizeScript("Introducing the revolutionary portable speaker.");

  it("reports unconfigured when API key is missing", async () => {
    const provider = new GeminiDirectorProvider({ apiKey: "" });
    expect(provider.isConfigured()).toBe(false);

    await expect(
      provider.analyze({
        scriptUnits: units,
      })
    ).rejects.toThrow(ProviderError);
  });

  it("correctly identifies configured state when API key is provided", () => {
    const provider = new GeminiDirectorProvider({ apiKey: "fake-key-for-test" });
    expect(provider.isConfigured()).toBe(true);
    expect(provider.id).toBe("gemini-director");
    expect(provider.modelName).toBe("gemini-3.7-flash");
  });

  it("builds clean repair prompt with sanitized errors", () => {
    const provider = new GeminiDirectorProvider({ apiKey: "fake-key" });
    const repairPrompt = provider.buildRepairPrompt({
      scriptUnits: units,
      rawOutput: { test: "invalid" },
      validationErrors: ["Scene 1: missing unitId u0001"],
    });

    expect(repairPrompt).toContain("REPAIR TASK");
    expect(repairPrompt).toContain("Scene 1: missing unitId u0001");
    expect(repairPrompt).toContain("[u0001]");
  });
});
