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

  it("times out a never-resolving SDK call within configured timeoutMs and normalizes to ProviderError TIMEOUT", async () => {
    const provider = new GeminiDirectorProvider({
      apiKey: "fake-api-key",
      timeoutMs: 50,
      maxRetries: 0,
    });

    // Mock client model generating a hanging promise
    (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
      models: {
        generateContent: () => new Promise(() => {}), // Never resolves
      },
    };

    const start = Date.now();
    await expect(provider.analyze({ scriptUnits: units })).rejects.toThrowError(
      /timed out after 50ms/
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("retries timeout attempts up to maxRetries bound and then fails safely", async () => {
    const provider = new GeminiDirectorProvider({
      apiKey: "fake-api-key",
      timeoutMs: 30,
      maxRetries: 2,
    });

    let callCount = 0;
    (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
      models: {
        generateContent: async () => {
          callCount++;
          return new Promise(() => {}); // Never resolves
        },
      },
    };

    await expect(provider.analyze({ scriptUnits: units })).rejects.toThrow(ProviderError);
    // Initial attempt (0) + 2 retries = 3 total attempts
    expect(callCount).toBe(3);
  });

  it("retries transient 429 / 5xx errors up to the retry bound and normalizes error code", async () => {
    const provider = new GeminiDirectorProvider({
      apiKey: "fake-api-key",
      timeoutMs: 5000,
      maxRetries: 2,
    });

    let callCount = 0;
    (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
      models: {
        generateContent: async () => {
          callCount++;
          throw new Error("Resource has been exhausted (e.g. check quota) 429 Rate Limit");
        },
      },
    };

    await expect(provider.analyze({ scriptUnits: units })).rejects.toThrowError(
      /rate limit exceeded \(HTTP 429\)/
    );
    expect(callCount).toBe(3);
  });

  it("never retries 401 / 403 / auth failures (executes exactly 1 attempt)", async () => {
    const provider = new GeminiDirectorProvider({
      apiKey: "fake-api-key",
      timeoutMs: 5000,
      maxRetries: 3,
    });

    let callCount = 0;
    (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
      models: {
        generateContent: async () => {
          callCount++;
          throw new Error("API_KEY_INVALID: 401 Unauthorized");
        },
      },
    };

    await expect(provider.analyze({ scriptUnits: units })).rejects.toThrowError(
      /invalid Gemini API key/
    );
    expect(callCount).toBe(1); // No retries for auth errors
  });

  it("never retries schema validation or malformed JSON failures", async () => {
    const provider = new GeminiDirectorProvider({
      apiKey: "fake-api-key",
      timeoutMs: 5000,
      maxRetries: 3,
    });

    let callCount = 0;
    (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
      models: {
        generateContent: async () => {
          callCount++;
          return { text: "NOT_JSON_RESPONSE" };
        },
      },
    };

    await expect(provider.analyze({ scriptUnits: units })).rejects.toThrow(ProviderError);
    expect(callCount).toBe(1); // No retries for malformed JSON
  });

  it("successfully parses valid structured JSON output", async () => {
    const provider = new GeminiDirectorProvider({
      apiKey: "fake-api-key",
      timeoutMs: 5000,
      maxRetries: 1,
    });

    const validPlan = {
      language: "ENGLISH",
      contentType: "ADVERTISEMENT",
      summary: "Commercial summary text for portable speaker.",
      creativeDirection: "Dynamic outdoor footage with energetic audio.",
      scenes: [
        {
          order: 1,
          unitIds: ["u0001"],
          purpose: "HOOK",
          visualBrief: "Speaker playing on beach with waves in background.",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Energetic",
          setting: "Beach",
          subject: "Portable Speaker",
          productPresence: "PREFERRED",
          searchQuery: "portable speaker beach",
          keywords: ["speaker", "beach"],
          manualAiPrompt: null,
        },
      ],
    };

    (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify(validPlan),
        }),
      },
    };

    const output = await provider.analyze({ scriptUnits: units });
    expect(output.summary).toBe("Commercial summary text for portable speaker.");
    expect(output.scenes).toHaveLength(1);
  });

  it("redacts API keys and secrets from surfaced errors", async () => {
    const secretKey = "AIzaSySecretApiKey123456789";
    const provider = new GeminiDirectorProvider({
      apiKey: secretKey,
      timeoutMs: 5000,
      maxRetries: 0,
    });

    (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
      models: {
        generateContent: async () => {
          throw new Error(`Failed to connect to endpoint key=${secretKey}&mode=strict`);
        },
      },
    };

    try {
      await provider.analyze({ scriptUnits: units });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const msg = (err as Error).message;
      expect(msg).not.toContain(secretKey);
      expect(msg).toContain("key=[REDACTED]");
    }
  });
});
