import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenRouterDirectorProvider } from "@/providers/ai/openrouter-director.provider";
import { DirectorExecutionBudget } from "@/providers/ai/ai-provider.interface";
import { ProviderError } from "@/domain/errors";
import { unitizeScript } from "@/domain/director/unitizer";

describe("OpenRouterDirectorProvider Unit & Error Handling Tests", () => {
  const units = unitizeScript("Introducing the next-generation wireless earbuds.");

  const validPlanPayload = {
    language: "ENGLISH",
    contentType: "ADVERTISEMENT",
    summary: "Commercial summary text for wireless earbuds.",
    creativeDirection: "Dynamic lifestyle shots with crystal clear audio.",
    scenes: [
      {
        order: 1,
        unitIds: ["u0001"],
        purpose: "HOOK",
        visualBrief: "Earbuds close-up on charging case opening with glowing LEDs.",
        visualSourceHint: "STOCK",
        shotType: "PRODUCT_DETAIL",
        mood: "Modern",
        setting: "Studio desk",
        subject: "Wireless Earbuds",
        productPresence: "PREFERRED",
        searchQuery: "wireless earbuds tech studio",
        keywords: ["earbuds", "audio", "wireless"],
        manualAiPrompt: null,
      },
    ],
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reports isConfigured as false when apiKey is empty or whitespace", () => {
    const unconfiguredA = new OpenRouterDirectorProvider({ apiKey: "" });
    const unconfiguredB = new OpenRouterDirectorProvider({ apiKey: "   " });
    const unconfiguredC = new OpenRouterDirectorProvider({});

    expect(unconfiguredA.isConfigured()).toBe(false);
    expect(unconfiguredB.isConfigured()).toBe(false);
    expect(unconfiguredC.isConfigured()).toBe(false);
  });

  it("reports isConfigured as true when apiKey is present", () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-v1-testkey" });
    expect(provider.isConfigured()).toBe(true);
    expect(provider.modelName).toBe("minimax/minimax-m3:free");
  });

  it("throws AUTH_FAILURE ProviderError if analyze or repair is called when unconfigured", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "" });

    await expect(provider.analyze({ scriptUnits: units })).rejects.toThrow(ProviderError);
    await expect(
      provider.repair({
        scriptUnits: units,
        rawOutput: {},
        validationErrors: ["Some error"],
      })
    ).rejects.toThrow(ProviderError);
  });

  it("successfully parses valid JSON response from OpenRouter chat completions", async () => {
    const provider = new OpenRouterDirectorProvider({
      apiKey: "sk-or-test",
      model: "minimax/minimax-m3:free",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(validPlanPayload),
            },
          },
        ],
      }),
    } as unknown as Response);

    const budget = new DirectorExecutionBudget();
    const result = await provider.analyze({ scriptUnits: units, budget });

    expect(result.language).toBe("ENGLISH");
    expect(result.contentType).toBe("ADVERTISEMENT");
    expect(result.scenes).toHaveLength(1);
    expect(result.model).toBe("minimax/minimax-m3:free");
    expect(budget.totalCallsUsed).toBe(1);
    expect(budget.openRouterAttemptsUsed).toBe(1);
  });

  it("successfully cleans markdown code fences from OpenRouter assistant content", async () => {
    const provider = new OpenRouterDirectorProvider({
      apiKey: "sk-or-test",
      model: "minimax/minimax-m3:free",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: "```json\n" + JSON.stringify(validPlanPayload) + "\n```",
            },
          },
        ],
      }),
    } as unknown as Response);

    const result = await provider.analyze({ scriptUnits: units });
    expect(result.summary).toBe(validPlanPayload.summary);
    expect(result.model).toBe("minimax/minimax-m3:free");
  });

  it("normalizes HTTP 401/403 into AUTH_FAILURE ProviderError", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-invalid" });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
    } as unknown as Response);

    try {
      await provider.analyze({ scriptUnits: units });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.details?.code).toBe("AUTH_FAILURE");
    }
  });

  it("normalizes HTTP 429 into RATE_LIMITED ProviderError and marks budget route", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-valid" });
    const budget = new DirectorExecutionBudget();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: "Rate limit exceeded" } }),
    } as unknown as Response);

    try {
      await provider.analyze({ scriptUnits: units, budget });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.details?.code).toBe("RATE_LIMITED");
      expect(budget.rateLimitedRoutes.has("openrouter")).toBe(true);
    }
  });

  it("normalizes HTTP 503 into UPSTREAM_UNAVAILABLE ProviderError and records fallback eligible", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-valid" });
    const budget = new DirectorExecutionBudget();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    } as unknown as Response);

    try {
      await provider.analyze({ scriptUnits: units, budget });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.details?.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(budget.fallbackEligibleEncountered).toBe(true);
    }
  });

  it("normalizes explicit free-model temporarily unavailable error into UPSTREAM_UNAVAILABLE", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-valid" });
    const budget = new DirectorExecutionBudget();

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "The free model minimax/minimax-m3:free is temporarily overloaded and unavailable",
    } as unknown as Response);

    try {
      await provider.analyze({ scriptUnits: units, budget });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.details?.code).toBe("UPSTREAM_UNAVAILABLE");
      expect(budget.fallbackEligibleEncountered).toBe(true);
    }
  });

  it("normalizes network fetch failure into NETWORK_FAILURE ProviderError", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-valid" });
    const budget = new DirectorExecutionBudget();

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch failed ECONNREFUSED 104.18.2.1:443"));

    try {
      await provider.analyze({ scriptUnits: units, budget });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.details?.code).toBe("NETWORK_FAILURE");
      expect(budget.fallbackEligibleEncountered).toBe(true);
    }
  });

  it("normalizes empty assistant response into EMPTY_RESPONSE ProviderError", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-valid" });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: "",
            },
          },
        ],
      }),
    } as unknown as Response);

    try {
      await provider.analyze({ scriptUnits: units });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.details?.code).toBe("EMPTY_RESPONSE");
    }
  });

  it("normalizes malformed JSON assistant content into MALFORMED_JSON ProviderError", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-valid" });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: "{ this is not valid JSON }",
            },
          },
        ],
      }),
    } as unknown as Response);

    try {
      await provider.analyze({ scriptUnits: units });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.details?.code).toBe("MALFORMED_JSON");
    }
  });

  it("normalizes schema-invalid JSON output into SCHEMA_VALIDATION_FAILED ProviderError", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-valid" });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                language: "INVALID_LANG",
                contentType: "ADVERTISEMENT",
                summary: "Short",
                scenes: [],
              }),
            },
          },
        ],
      }),
    } as unknown as Response);

    try {
      await provider.analyze({ scriptUnits: units });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const provErr = err as ProviderError;
      expect(provErr.details?.code).toBe("SCHEMA_VALIDATION_FAILED");
    }
  });

  it("proves repair executes with correct prompt structure and handles errors", async () => {
    const provider = new OpenRouterDirectorProvider({ apiKey: "sk-or-valid" });

    let capturedRequestBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url, options) => {
      capturedRequestBody = options.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify(validPlanPayload),
              },
            },
          ],
        }),
      } as Response;
    });

    const budget = new DirectorExecutionBudget();
    const result = await provider.repair({
      scriptUnits: units,
      rawOutput: { language: "ENGLISH" },
      validationErrors: ["Unit u0001 was omitted"],
      budget,
    });

    expect(result.language).toBe("ENGLISH");
    expect(capturedRequestBody).toBeDefined();
    const parsedBody = JSON.parse(capturedRequestBody!);
    expect(parsedBody.model).toBe("minimax/minimax-m3:free");
    expect(parsedBody.messages[1].content).toContain("REPAIR TASK");
    expect(parsedBody.messages[1].content).toContain("Unit u0001 was omitted");
  });
});
