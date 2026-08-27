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
      /timed out/
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
      /rate limit exceeded/
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
      /authentication or permission failed/
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

  describe("Allowlist-Based Secret Isolation & Hostile Upstream Error Tests", () => {
    const hostileSecretShapes = [
      {
        name: "1. query parameter key pattern",
        error: "Failed to connect: https://generativelanguage.googleapis.com/v1beta?key=AIzaSy_VERY_SECRET_KEY_12345&mode=full",
        secret: "AIzaSy_VERY_SECRET_KEY_12345",
      },
      {
        name: "2. json style apiKey pattern",
        error: 'Upstream rejection: {"error":{"code":400,"message":"Invalid request","apiKey":"SECRET_API_KEY_ABCD1234"}}',
        secret: "SECRET_API_KEY_ABCD1234",
      },
      {
        name: "3. Authorization Bearer header pattern",
        error: "Request failed with Authorization: Bearer ya29.a0AfH6SMA_VERY_SECRET_BEARER_TOKEN_xyz",
        secret: "ya29.a0AfH6SMA_VERY_SECRET_BEARER_TOKEN_xyz",
      },
      {
        name: "4. standalone Bearer token",
        error: "Failed token validation: Bearer SECRET_BEARER_VALUE_98765 expired",
        secret: "SECRET_BEARER_VALUE_98765",
      },
      {
        name: "5. full URL with api_key query param",
        error: "Network error fetching https://example.test/request?api_key=SECRET_PARAM_TOKEN_54321",
        secret: "SECRET_PARAM_TOKEN_54321",
      },
      {
        name: "6. Windows absolute filesystem path",
        error: "ENOENT: could not load config from C:\\Users\\Usman\\secret\\production_config.json",
        secret: "C:\\Users\\Usman\\secret\\production_config.json",
      },
      {
        name: "7. Linux absolute filesystem path",
        error: "EACCES: permission denied opening /home/user/secrets/vault_keys.json",
        secret: "/home/user/secrets/vault_keys.json",
      },
      {
        name: "8. raw response containing prompt and tokens",
        error: 'Raw SDK stream dump: {"prompt":"SUPER SECRET PROMPT TEXT","token":"SECRET_TOKEN_XYZ_999"}',
        secret: "SUPER SECRET PROMPT TEXT",
      },
      {
        name: "9. arbitrary provider-internal diagnostic message",
        error: "InternalGrpcChannelTransportException: channel 0x7f884920 terminated by peer with debug info [NODE_DEBUG_TRACE_INTERNAL_STATE]",
        secret: "NODE_DEBUG_TRACE_INTERNAL_STATE",
      },
      {
        name: "10. complex mixture of paths, tokens, URLs, and secrets in one message",
        error: "Fatal crash at C:\\app\\secret\\key.pem: HTTP 500 from https://internal.ai.corp/v1?token=TOP_SECRET_AUTH_9999 with Bearer TOKEN_12345",
        secret: "TOP_SECRET_AUTH_9999",
      },
    ];

    for (const { name, error, secret } of hostileSecretShapes) {
      it(`never leaks sensitive material into ProviderError for: ${name}`, async () => {
        const provider = new GeminiDirectorProvider({
          apiKey: "test-configured-key",
          timeoutMs: 5000,
          maxRetries: 0,
        });

        (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
          models: {
            generateContent: async () => {
              throw new Error(error);
            },
          },
        };

        try {
          await provider.analyze({ scriptUnits: units });
          expect.unreachable();
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(ProviderError);
          const providerErr = err as ProviderError;

          // Assert ProviderError.message NEVER contains the secret
          expect(providerErr.message).not.toContain(secret);

          // Assert ProviderError.details NEVER contains the secret
          const detailsString = JSON.stringify(providerErr.details || {});
          expect(detailsString).not.toContain(secret);

          // Assert message is an allowlisted fixed string
          expect([
            "Gemini authentication or permission failed",
            "Gemini rate limit exceeded",
            "Gemini request timed out",
            "Gemini service temporarily unavailable",
            "Gemini network connection failed",
            "Gemini returned malformed JSON response",
            "Gemini structured output failed schema validation",
            "Gemini generation blocked by safety filters",
            "Gemini generation terminated unexpectedly",
            "Gemini returned an empty response",
            "Gemini request failed",
          ]).toContain(providerErr.message);
        }
      });
    }
  });

  describe("Hard-Bounded Retry Contract Tests", () => {
    const extremeRetryValues = [
      { input: -1, expectedAttempts: 1 },
      { input: -999999, expectedAttempts: 1 },
      { input: 0, expectedAttempts: 1 },
      { input: 1, expectedAttempts: 2 },
      { input: 2, expectedAttempts: 3 },
      { input: 3, expectedAttempts: 3 }, // Clamped to 2 retries (3 attempts)
      { input: 999999, expectedAttempts: 3 }, // Clamped to 2 retries (3 attempts)
      { input: 1.5, expectedAttempts: 2 }, // Floored to 1 retry (2 attempts)
      { input: Infinity, expectedAttempts: 3 }, // Fallback to safe 2 retries (3 attempts)
      { input: -Infinity, expectedAttempts: 3 }, // Fallback to safe 2 retries (3 attempts)
      { input: NaN, expectedAttempts: 3 }, // Fallback to safe 2 retries (3 attempts)
    ];

    for (const { input, expectedAttempts } of extremeRetryValues) {
      it(`bounds retry attempts to exactly ${expectedAttempts} (max 3) for maxRetries = ${input}`, async () => {
        const provider = new GeminiDirectorProvider({
          apiKey: "test-configured-key",
          timeoutMs: 5000,
          maxRetries: input as number,
        });

        let callCount = 0;
        (provider as unknown as { client: { models: { generateContent: () => Promise<unknown> } } }).client = {
          models: {
            generateContent: async () => {
              callCount++;
              throw new Error("Transient 503 Service Unavailable");
            },
          },
        };

        await expect(provider.analyze({ scriptUnits: units })).rejects.toThrow(ProviderError);
        expect(callCount).toBe(expectedAttempts);
        expect(callCount).toBeLessThanOrEqual(3);
      });
    }
  });
});
