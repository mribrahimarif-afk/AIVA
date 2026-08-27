import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ResilientDirectorProvider } from "@/providers/ai/resilient-director.provider";
import { GeminiDirectorProvider } from "@/providers/ai/gemini-director.provider";
import { OpenRouterDirectorProvider } from "@/providers/ai/openrouter-director.provider";
import { DirectorExecutionBudget } from "@/providers/ai/ai-provider.interface";
import { ProviderError } from "@/domain/errors";
import { unitizeScript } from "@/domain/director/unitizer";
import { validateAndReconstructPlan } from "@/domain/director";
import { RawDirectorOutput } from "@/domain/director/director.types";
import { Logger } from "@/infrastructure/logging/logger";

describe("ResilientDirectorProvider Multi-Provider Resilience Tests", () => {
  const englishScript = "Introducing the ultimate smart water bottle that tracks your hydration.";
  const urduScript = "پیش ہے پاکستان کا سب سے جدید اور پائیدار موبائل فون جو آپ کی زندگی کو آسان بنائے۔";
  const romanUrduScript = "Yeh naya smart speaker zabardast sound aur lambi battery life ke sath aata hai.";
  const mixedScript = "Get ready for the launch! نیا سمارٹ فون with 5G connectivity aur zabardast camera.";
  const emojiPunctScript = "🚀 Wow! Amazing speaker... (50% OFF) 🔥 Get yours today: https://example.com/buy 🎉";
  const longUnpunctuatedScript =
    "a revolutionary device designed to transform the way people live work and communicate with unparalleled speed incredible battery life state of the art display and seamless connectivity for everyone everywhere anytime";

  const makeValidOutput = (units: Array<{ id: string }>, modelName: string): RawDirectorOutput => ({
    language: "ENGLISH",
    contentType: "ADVERTISEMENT",
    summary: "Video advertisement summary for product.",
    creativeDirection: "Dynamic cinematic visuals with clear product emphasis.",
    scenes: [
      {
        order: 1,
        unitIds: units.map((u) => u.id),
        purpose: "HOOK",
        visualBrief: "Cinematic close-up of product in action with vibrant lighting.",
        visualSourceHint: "STOCK",
        shotType: "LIFESTYLE",
        mood: "Energetic",
        setting: "Modern studio",
        subject: "Product",
        productPresence: "PREFERRED",
        searchQuery: "product tech lifestyle",
        keywords: ["product", "tech", "cinematic"],
        manualAiPrompt: null,
      },
    ],
    model: modelName,
  });

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("1. GEMINI 3.7 SUCCESS: primary succeeds on 1st call -> Gemini 2.5 and OpenRouter unused", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "test-openrouter-key" });

    let geminiCalls = 0;
    let openrouterCalls = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model, input) => {
      geminiCalls++;
      return makeValidOutput(input.scriptUnits, model);
    });

    vi.spyOn(openrouter, "analyze").mockImplementation(async (input) => {
      openrouterCalls++;
      return makeValidOutput(input.scriptUnits, openrouter.modelName);
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);
    const result = await resilient.analyze({ scriptUnits: units, budget });

    expect(result.model).toBe("gemini-3.7-flash");
    expect(geminiCalls).toBe(1);
    expect(openrouterCalls).toBe(0);
    expect(budget.totalCallsUsed).toBe(1);
    expect(budget.primaryAttemptsUsed).toBe(1);
  });

  it("2. GEMINI 3.7 TRANSIENT FAILURE -> GEMINI 2.5 SUCCESS: OpenRouter unused", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "test-openrouter-key" });

    let gemini37Calls = 0;
    let gemini25Calls = 0;
    let openrouterCalls = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model, input) => {
      if (model === "gemini-3.7-flash") {
        gemini37Calls++;
        throw new Error("503 Service Unavailable");
      }
      if (model === "gemini-2.5-flash") {
        gemini25Calls++;
        return makeValidOutput(input.scriptUnits, model);
      }
      throw new Error("Unknown model");
    });

    vi.spyOn(openrouter, "analyze").mockImplementation(async (input) => {
      openrouterCalls++;
      return makeValidOutput(input.scriptUnits, openrouter.modelName);
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);
    const result = await resilient.analyze({ scriptUnits: units, budget });

    expect(result.model).toBe("gemini-2.5-flash");
    expect(gemini25Calls).toBe(1);
    expect(openrouterCalls).toBe(0);
    expect(budget.fallbackAttemptsUsed).toBe(1);
  });

  it("3. GEMINI 3.7 RATE_LIMITED: NO same-model retry -> immediately advances to Gemini 2.5", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "test-openrouter-key" });

    let gemini37Calls = 0;
    let gemini25Calls = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model, input) => {
      if (model === "gemini-3.7-flash") {
        gemini37Calls++;
        throw new ProviderError("gemini", "Gemini 429 quota exhausted", {
          code: "RATE_LIMITED",
          status: 429,
        });
      }
      if (model === "gemini-2.5-flash") {
        gemini25Calls++;
        return makeValidOutput(input.scriptUnits, model);
      }
      throw new Error("Unknown model");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);
    const result = await resilient.analyze({ scriptUnits: units, budget });

    expect(result.model).toBe("gemini-2.5-flash");
    // Assert strictly NO same-model retry occurred on Gemini 3.7
    expect(gemini37Calls).toBe(1);
    expect(gemini25Calls).toBe(1);
    expect(budget.rateLimitedRoutes.has("gemini-primary")).toBe(true);
  });

  it("4. GEMINI 3.7 RATE_LIMITED -> GEMINI 2.5 RATE_LIMITED -> OpenRouter MiniMax SUCCESS", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "test-openrouter-key" });

    let gemini37Calls = 0;
    let gemini25Calls = 0;
    let openrouterCalls = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model) => {
      if (model === "gemini-3.7-flash") {
        gemini37Calls++;
        throw new ProviderError("gemini", "429 Resource Exhausted", {
          code: "RATE_LIMITED",
          status: 429,
        });
      }
      if (model === "gemini-2.5-flash") {
        gemini25Calls++;
        throw new ProviderError("gemini", "429 Resource Exhausted", {
          code: "RATE_LIMITED",
          status: 429,
        });
      }
      throw new Error("Unknown model");
    });

    vi.spyOn(openrouter, "callDirect").mockImplementation(async (_action, input) => {
      openrouterCalls++;
      return makeValidOutput(input.scriptUnits, "minimax/minimax-m3:free");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(romanUrduScript);
    const result = await resilient.analyze({ scriptUnits: units, budget });

    expect(result.model).toBe("minimax/minimax-m3:free");
    // Exactly 1 call on 3.7 (no retry), 1 call on 2.5 (no retry), 1 call on MiniMax (success) = 3 calls
    expect(gemini37Calls).toBe(1);
    expect(gemini25Calls).toBe(1);
    expect(openrouterCalls).toBe(1);
    expect(budget.totalCallsUsed).toBe(3);
    expect(budget.rateLimitedRoutes.has("gemini-primary")).toBe(true);
    expect(budget.rateLimitedRoutes.has("gemini-fallback")).toBe(true);
  });

  it("5. ALL GEMINI MODELS UNAVAILABLE (503/500) -> MiniMax SUCCESS", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "test-openrouter-key" });

    vi.spyOn(gemini, "callDirect").mockImplementation(async () => {
      throw new Error("503 Service Unavailable");
    });

    vi.spyOn(openrouter, "callDirect").mockImplementation(async (_action, input) => {
      return makeValidOutput(input.scriptUnits, "minimax/minimax-m3:free");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(urduScript);
    const result = await resilient.analyze({ scriptUnits: units, budget });

    expect(result.model).toBe("minimax/minimax-m3:free");
    expect(budget.totalCallsUsed).toBeLessThanOrEqual(4);
  });

  it("6. GEMINI TIMEOUT: no consecutive 45s retry on timed-out route -> downstream routes reachable", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key", timeoutMs: 100 });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "test-openrouter-key" });

    let gemini37Calls = 0;
    let gemini25Calls = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model, input) => {
      if (model === "gemini-3.7-flash") {
        gemini37Calls++;
        throw new ProviderError("gemini", "Gemini timeout after 45000ms", {
          code: "TIMEOUT",
          timeoutMs: 45000,
        });
      }
      if (model === "gemini-2.5-flash") {
        gemini25Calls++;
        return makeValidOutput(input.scriptUnits, model);
      }
      throw new Error("Unknown model");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);
    const result = await resilient.analyze({ scriptUnits: units, budget });

    expect(result.model).toBe("gemini-2.5-flash");
    expect(gemini37Calls).toBe(1); // Promptly broke without 2nd 45s attempt
    expect(gemini25Calls).toBe(1);
    expect(budget.timedOutRoutes.has("gemini-primary")).toBe(true);
  });

  it("7. OPENROUTER MISSING KEY: app startup remains valid, Gemini-only path works, fails safely when chain exhausted", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const unconfiguredOpenRouter = new OpenRouterDirectorProvider({ apiKey: "" });

    expect(unconfiguredOpenRouter.isConfigured()).toBe(false);

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: unconfiguredOpenRouter,
    });

    expect(resilient.isConfigured()).toBe(true);

    // Gemini success works normally
    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model, input) => {
      return makeValidOutput(input.scriptUnits, model);
    });

    const units = unitizeScript(englishScript);
    const result = await resilient.analyze({ scriptUnits: units });
    expect(result.model).toBe("gemini-3.7-flash");

    // When Gemini chain is exhausted, fails safely with normalized error without OpenRouter leakage
    vi.spyOn(gemini, "callDirect").mockImplementation(async () => {
      throw new Error("503 Service Unavailable");
    });

    await expect(resilient.analyze({ scriptUnits: units })).rejects.toThrow(ProviderError);
  });

  it("8. OPENROUTER 401/403: normalized AUTH_FAILURE -> no repeated calls", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "invalid-key" });

    vi.spyOn(gemini, "callDirect").mockRejectedValue(new Error("503 Service Unavailable"));

    let openrouterCalls = 0;
    vi.spyOn(openrouter, "callDirect").mockImplementation(async () => {
      openrouterCalls++;
      throw new ProviderError("openrouter-director", "OpenRouter auth failed", {
        code: "AUTH_FAILURE",
        status: 401,
      });
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const units = unitizeScript(englishScript);
    await expect(resilient.analyze({ scriptUnits: units })).rejects.toThrow(ProviderError);
    expect(openrouterCalls).toBe(1); // Zero repeated calls
  });

  it("9. OPENROUTER 429: normalized RATE_LIMITED -> no same-route retry", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    vi.spyOn(gemini, "callDirect").mockRejectedValue(new Error("503 Service Unavailable"));

    let openrouterCalls = 0;
    vi.spyOn(openrouter, "callDirect").mockImplementation(async () => {
      openrouterCalls++;
      throw new ProviderError("openrouter-director", "OpenRouter rate limited", {
        code: "RATE_LIMITED",
        status: 429,
      });
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const units = unitizeScript(englishScript);
    try {
      await resilient.analyze({ scriptUnits: units });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("RATE_LIMITED");
      expect(openrouterCalls).toBe(1); // Zero same-route retry
    }
  });

  it("10. OPENROUTER 5xx / NETWORK FAILURE: safe normalized transient error and globally bounded", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    vi.spyOn(gemini, "callDirect").mockRejectedValue(new Error("503 Service Unavailable"));
    vi.spyOn(openrouter, "callDirect").mockRejectedValue(
      new ProviderError("openrouter-director", "OpenRouter network failure", {
        code: "NETWORK_FAILURE",
      })
    );

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);

    await expect(resilient.analyze({ scriptUnits: units, budget })).rejects.toThrow(ProviderError);
    expect(budget.totalCallsUsed).toBeLessThanOrEqual(4);
  });

  it("11. OPENROUTER MODEL UNAVAILABLE: no retry storm -> safe normalized failure", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    vi.spyOn(gemini, "callDirect").mockRejectedValue(new Error("503 Service Unavailable"));
    vi.spyOn(openrouter, "callDirect").mockRejectedValue(
      new ProviderError("openrouter-director", "Free model temporarily unavailable", {
        code: "UPSTREAM_UNAVAILABLE",
      })
    );

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);

    await expect(resilient.analyze({ scriptUnits: units, budget })).rejects.toThrow(ProviderError);
    expect(budget.totalCallsUsed).toBeLessThanOrEqual(4);
  });

  it("12. MINIMAX MALFORMED JSON: NOT treated as transport fallback -> existing validation/repair flow", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    vi.spyOn(gemini, "callDirect").mockRejectedValue(new Error("503 Service Unavailable"));
    vi.spyOn(openrouter, "callDirect").mockRejectedValue(
      new ProviderError("openrouter-director", "Malformed JSON", {
        code: "MALFORMED_JSON",
      })
    );

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const units = unitizeScript(englishScript);
    // Malformed JSON is thrown directly as a fatal semantic error (to be repaired), not hopped as a transport error
    await expect(resilient.analyze({ scriptUnits: units })).rejects.toThrow(ProviderError);
  });

  it("13 & 14. MINIMAX VALIDATION & REPAIR: local invariants authoritative and repaired through OpenRouter if budget remains", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    const units = unitizeScript(englishScript);

    // Initial output from MiniMax has missing unit
    const invalidOutput = {
      language: "ENGLISH",
      contentType: "ADVERTISEMENT",
      summary: "Invalid output missing units",
      creativeDirection: "Direction",
      scenes: [
        {
          order: 1,
          unitIds: [units[0]!.id], // missing second unit
          purpose: "HOOK",
          visualBrief: "Visual brief hook",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Energetic",
          setting: "Beach",
          subject: "Speaker",
          productPresence: "PREFERRED",
          searchQuery: "beach speaker",
          keywords: ["beach", "speaker"],
          manualAiPrompt: null,
        },
      ],
      model: "minimax/minimax-m3:free",
    };

    const repairedOutput = makeValidOutput(units, "minimax/minimax-m3:free");

    vi.spyOn(gemini, "callDirect").mockImplementation(async () => {
      throw new ProviderError("gemini", "Rate limited", {
        code: "RATE_LIMITED",
        status: 429,
      });
    });
    vi.spyOn(openrouter, "callDirect").mockImplementation(async (action) => {
      if (action === "analyze") return invalidOutput as never;
      return repairedOutput as never;
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const initialOut = await resilient.analyze({ scriptUnits: units, budget });
    const initialValidation = validateAndReconstructPlan(initialOut, units, englishScript);
    expect(initialValidation.success).toBe(false);

    const repairedOut = await resilient.repair({
      scriptUnits: units,
      rawOutput: initialOut,
      validationErrors: initialValidation.errors,
      budget,
    });

    const finalValidation = validateAndReconstructPlan(repairedOut, units, englishScript);
    expect(finalValidation.success).toBe(true);
    expect(repairedOut.model).toBe("minimax/minimax-m3:free");
    expect(budget.totalCallsUsed).toBeLessThanOrEqual(4);
  });

  it("15. MINIMAX VALID RESULT: reports actual model as minimax/minimax-m3:free", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({
      apiKey: "valid-key",
      model: "minimax/minimax-m3:free",
    });

    vi.spyOn(gemini, "callDirect").mockRejectedValue(new Error("503 Service Unavailable"));
    vi.spyOn(openrouter, "callDirect").mockImplementation(async (_action, input) => {
      return makeValidOutput(input.scriptUnits, "minimax/minimax-m3:free");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const units = unitizeScript(englishScript);
    const result = await resilient.analyze({ scriptUnits: units });
    expect(result.model).toBe("minimax/minimax-m3:free");
  });

  it("16. ANALYZE + REPAIR + THREE-PROVIDER ROUTING: enforces absolute max 4 external calls (no 5th call)", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    let totalExternalCalls = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async () => {
      totalExternalCalls++;
      if (totalExternalCalls > 4) {
        throw new Error("ILLEGAL_CALL_5");
      }
      throw new ProviderError("gemini", "Rate limited", {
        code: "RATE_LIMITED",
        status: 429,
      });
    });

    vi.spyOn(openrouter, "callDirect").mockImplementation(async (action, input) => {
      totalExternalCalls++;
      if (totalExternalCalls > 4) {
        throw new Error("ILLEGAL_CALL_5");
      }
      if (action === "analyze") {
        return {
          language: "ENGLISH",
          contentType: "ADVERTISEMENT",
          summary: "Invalid output",
          creativeDirection: "Direction",
          scenes: [
            {
              order: 1,
              unitIds: [input.scriptUnits![0]!.id],
              purpose: "HOOK",
              visualBrief: "Visual brief hook",
              visualSourceHint: "STOCK",
              shotType: "LIFESTYLE",
              mood: "Energetic",
              setting: "Beach",
              subject: "Speaker",
              productPresence: "PREFERRED",
              searchQuery: "beach speaker",
              keywords: ["beach", "speaker"],
              manualAiPrompt: null,
            },
          ],
          model: "minimax/minimax-m3:free",
        } as RawDirectorOutput;
      }
      return makeValidOutput(input.scriptUnits!, "minimax/minimax-m3:free");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);

    const initialOut = await resilient.analyze({ scriptUnits: units, budget });
    const validation = validateAndReconstructPlan(initialOut, units, englishScript);
    expect(validation.success).toBe(false);

    // Call repair
    const repaired = await resilient.repair({
      scriptUnits: units,
      rawOutput: initialOut,
      validationErrors: validation.errors,
      budget,
    });

    expect(repaired.model).toBe("minimax/minimax-m3:free");
    expect(totalExternalCalls).toBeLessThanOrEqual(4);
    expect(budget.totalCallsUsed).toBeLessThanOrEqual(4);

    // Prove calling repair again when budget is exhausted fails without a 5th call
    expect(budget.hasRemainingBudget()).toBe(false);
    await expect(
      resilient.repair({
        scriptUnits: units,
        rawOutput: repaired,
        validationErrors: ["Extra error"],
        budget,
      })
    ).rejects.toThrow(ProviderError);

    expect(totalExternalCalls).toBeLessThanOrEqual(4);
  });

  it("17. THIRD-PROVIDER STARVATION TEST: upstream Gemini retries cannot starve untried MiniMax", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    let miniMaxReached = false;
    let gemini37Attempts = 0;
    let gemini25Attempts = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model) => {
      if (model === "gemini-3.7-flash") {
        gemini37Attempts++;
        throw new Error("503 Service Unavailable");
      }
      if (model === "gemini-2.5-flash") {
        gemini25Attempts++;
        throw new Error("503 Service Unavailable");
      }
      throw new Error("Unknown model");
    });

    vi.spyOn(openrouter, "callDirect").mockImplementation(async (_action, input) => {
      miniMaxReached = true;
      return makeValidOutput(input.scriptUnits!, "minimax/minimax-m3:free");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);

    const result = await resilient.analyze({ scriptUnits: units, budget });

    expect(miniMaxReached).toBe(true);
    expect(result.model).toBe("minimax/minimax-m3:free");
    expect(budget.totalCallsUsed).toBe(4);
    // Prove Gemini 3.7 got 2 calls, Gemini 2.5 got 1 call, and MiniMax got 1 call = 4 calls total
    expect(gemini37Attempts).toBe(2);
    expect(gemini25Attempts).toBe(1);
  });

  it("18. TIMEOUT STATE SURVIVES analyze -> repair: timed-out route is not re-attempted in repair", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    let gemini37CallsInRepair = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model, input) => {
      if (model === "gemini-3.7-flash") {
        if (budget.primaryTimeoutEncountered) {
          gemini37CallsInRepair++;
        }
        throw new ProviderError("gemini", "Timeout", { code: "TIMEOUT", timeoutMs: 45000 });
      }
      if (model === "gemini-2.5-flash") {
        // Return output requiring repair
        return {
          language: "ENGLISH",
          contentType: "ADVERTISEMENT",
          summary: "Invalid output",
          creativeDirection: "Direction",
          scenes: [
            {
              order: 1,
              unitIds: [input.scriptUnits![0]!.id],
              purpose: "HOOK",
              visualBrief: "Brief",
              visualSourceHint: "STOCK",
              shotType: "LIFESTYLE",
              mood: "Energetic",
              setting: "Studio",
              subject: "Subject",
              productPresence: "PREFERRED",
              searchQuery: "query",
              keywords: ["key"],
              manualAiPrompt: null,
            },
          ],
          model,
        } as RawDirectorOutput;
      }
      throw new Error("Unknown model");
    });

    vi.spyOn(openrouter, "callDirect").mockImplementation(async (_action, input) => {
      return makeValidOutput(input.scriptUnits!, "minimax/minimax-m3:free");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);

    const initial = await resilient.analyze({ scriptUnits: units, budget });
    expect(budget.timedOutRoutes.has("gemini-primary")).toBe(true);

    const repaired = await resilient.repair({
      scriptUnits: units,
      rawOutput: initial,
      validationErrors: ["Unit missing"],
      budget,
    });

    expect(repaired).toBeDefined();
    // Verify Gemini 3.7 was NEVER re-attempted during repair
    expect(gemini37CallsInRepair).toBe(0);
  });

  it("19. RATE_LIMITED ROUTE STATE SURVIVES analyze -> repair: rate-limited route is not re-attempted in repair", async () => {
    const gemini = new GeminiDirectorProvider({ apiKey: "test-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "valid-key" });

    let gemini37CallsInRepair = 0;

    vi.spyOn(gemini, "callDirect").mockImplementation(async (_action, model, input) => {
      if (model === "gemini-3.7-flash") {
        if (budget.rateLimitedRoutes.has("gemini-primary")) {
          gemini37CallsInRepair++;
        }
        throw new ProviderError("gemini", "429 Rate limited", {
          code: "RATE_LIMITED",
          status: 429,
        });
      }
      if (model === "gemini-2.5-flash") {
        return {
          language: "ENGLISH",
          contentType: "ADVERTISEMENT",
          summary: "Invalid output",
          creativeDirection: "Direction",
          scenes: [
            {
              order: 1,
              unitIds: [input.scriptUnits![0]!.id],
              purpose: "HOOK",
              visualBrief: "Brief",
              visualSourceHint: "STOCK",
              shotType: "LIFESTYLE",
              mood: "Energetic",
              setting: "Studio",
              subject: "Subject",
              productPresence: "PREFERRED",
              searchQuery: "query",
              keywords: ["key"],
              manualAiPrompt: null,
            },
          ],
          model,
        } as RawDirectorOutput;
      }
      throw new Error("Unknown model");
    });

    vi.spyOn(openrouter, "callDirect").mockImplementation(async (_action, input) => {
      return makeValidOutput(input.scriptUnits!, "minimax/minimax-m3:free");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
    });

    const budget = new DirectorExecutionBudget();
    const units = unitizeScript(englishScript);

    const initial = await resilient.analyze({ scriptUnits: units, budget });
    expect(budget.rateLimitedRoutes.has("gemini-primary")).toBe(true);

    const repaired = await resilient.repair({
      scriptUnits: units,
      rawOutput: initial,
      validationErrors: ["Unit missing"],
      budget,
    });

    expect(repaired).toBeDefined();
    // Verify Gemini 3.7 was NEVER re-attempted during repair
    expect(gemini37CallsInRepair).toBe(0);
  });

  it("20. INDEPENDENT CONCURRENT REQUESTS RECEIVE ISOLATED BUDGETS", async () => {
    const budgetA = new DirectorExecutionBudget();
    const budgetB = new DirectorExecutionBudget();

    budgetA.recordRouteCall("gemini-primary");
    budgetA.recordRouteRateLimited("gemini-primary");

    expect(budgetA.totalCallsUsed).toBe(1);
    expect(budgetA.rateLimitedRoutes.has("gemini-primary")).toBe(true);

    expect(budgetB.totalCallsUsed).toBe(0);
    expect(budgetB.rateLimitedRoutes.has("gemini-primary")).toBe(false);
    expect(budgetB.canMakeRouteCall("gemini-primary")).toBe(true);
  });

  it("21. LOGGING REDACTION: provider_fallback log contains zero keys, full scripts, or raw response bodies", async () => {
    const logs: unknown[] = [];
    const fakeLogger = {
      warn: (obj: unknown) => logs.push(obj),
      info: (obj: unknown) => logs.push(obj),
      error: (obj: unknown) => logs.push(obj),
      debug: (obj: unknown) => logs.push(obj),
    } as unknown as Logger;

    const gemini = new GeminiDirectorProvider({ apiKey: "secret-gemini-key" });
    const openrouter = new OpenRouterDirectorProvider({ apiKey: "secret-openrouter-key" });

    vi.spyOn(gemini, "callDirect").mockRejectedValue(new Error("503 Service Unavailable"));
    vi.spyOn(openrouter, "callDirect").mockImplementation(async (_action, input) => {
      return makeValidOutput(input.scriptUnits, "minimax/minimax-m3:free");
    });

    const resilient = new ResilientDirectorProvider({
      geminiProvider: gemini,
      openRouterProvider: openrouter,
      logger: fakeLogger,
    });

    const units = unitizeScript(englishScript);
    await resilient.analyze({ scriptUnits: units });

    const logStr = JSON.stringify(logs);
    expect(logStr).not.toContain("secret-gemini-key");
    expect(logStr).not.toContain("secret-openrouter-key");
    expect(logStr).not.toContain("Bearer");
    expect(logStr).not.toContain(englishScript);
  });

  it("22 to 27. MULTILINGUAL & FIDELITY REGRESSIONS: validates plan reconstruction across English, Urdu, Roman Urdu, Mixed, Emojis, Long Scripts", () => {
    const scripts = [
      englishScript,
      urduScript,
      romanUrduScript,
      mixedScript,
      emojiPunctScript,
      longUnpunctuatedScript,
    ];

    for (const script of scripts) {
      const units = unitizeScript(script);
      expect(units.length).toBeGreaterThan(0);

      // Reconstructed script exactly matches source script
      const reconstructed = units.map((u) => u.text).join("");
      expect(reconstructed).toBe(script);

      // Validate mock plan
      const plan = makeValidOutput(units, "minimax/minimax-m3:free");
      const validation = validateAndReconstructPlan(plan, units, script);
      expect(validation.success).toBe(true);
      expect(validation.scenes).toHaveLength(1);
    }
  });
});
