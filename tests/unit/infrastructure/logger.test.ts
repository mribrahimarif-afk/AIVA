import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/infrastructure/logging/logger";
import { resetEnvCache } from "@/infrastructure/config/env";

function captureLogLine(fn: () => void): Record<string, unknown> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    fn();
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    return JSON.parse(line) as Record<string, unknown>;
  } finally {
    spy.mockRestore();
  }
}

function captureErrorLogLine(fn: () => void): Record<string, unknown> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    fn();
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    return JSON.parse(line) as Record<string, unknown>;
  } finally {
    spy.mockRestore();
  }
}

describe("logger secret redaction", () => {
  beforeEach(() => {
    process.env.AIVA_LOG_LEVEL = "info";
    resetEnvCache();
  });
  afterEach(() => {
    process.env.AIVA_LOG_LEVEL = "error";
    resetEnvCache();
  });

  it("redacts a value under a secret-shaped key at the top level", () => {
    const record = captureLogLine(() =>
      logger.info({ event: "test.event", apiKey: "sk-live-abc123SECRET" })
    );
    expect(JSON.stringify(record)).not.toContain("sk-live-abc123SECRET");
    expect(record.apiKey).toBe("[REDACTED]");
  });

  it("redacts a value under a secret-shaped key nested inside another object", () => {
    const record = captureLogLine(() =>
      logger.info({
        event: "test.event",
        provider: "gemini",
        requestPayload: { headers: { Authorization: "Bearer super-secret-token-value" } },
      })
    );
    expect(JSON.stringify(record)).not.toContain("super-secret-token-value");
  });

  it("redacts secret-shaped content inside a plain top-level message string", () => {
    const record = captureLogLine(() =>
      logger.info({ event: "test.event", message: "Config loaded, api_key=AKIAABCDEFGHIJKLMNOP ready" })
    );
    expect(record.message).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(record.message).toContain("[REDACTED]");
  });

  it("redacts secret-shaped content inside an Error.message", () => {
    const record = captureErrorLogLine(() =>
      logger.error({
        event: "test.event",
        error: new Error("Request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.payload"),
      })
    );
    const error = record.error as { message: string };
    expect(error.message).not.toContain("eyJhbGciOiJIUzI1NiJ9.secret.payload");
    expect(error.message).toContain("[REDACTED]");
  });

  it("redacts secret-shaped content inside an Error.stack", () => {
    const err = new Error("boom");
    err.stack = `Error: boom\n    at fetchToken (token=ghp_1234567890abcdefghijklmnopqrstuvwxyz at line 1)`;

    const record = captureErrorLogLine(() => logger.error({ event: "test.event", error: err }));
    const error = record.error as { stack?: string };
    expect(error.stack ?? "").not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
  });

  it("redacts bare tokens (sk-, ghp_, AIza, AKIA, xox) completely from top-level message without leaking secret string", () => {
    const secrets = [
      "sk-proj-12345678901234567890",
      "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "AIzaSyA1234567890abcdefghijklmnopqrst",
      "AKIAIOSFODNN7EXAMPLE",
      "xoxb-dummy-test-token-value-123456",
    ];

    for (const secret of secrets) {
      const record = captureLogLine(() =>
        logger.info({ event: "test.event", message: `Connecting with bare token ${secret}` })
      );
      const logString = JSON.stringify(record);
      expect(logString).not.toContain(secret);
      expect(record.message).toBe("Connecting with bare token [REDACTED]");
    }
  });

  it("redacts bare tokens completely from Error.message", () => {
    const secret = "sk-proj-99999999998888888888";
    const record = captureErrorLogLine(() =>
      logger.error({
        event: "test.event",
        error: new Error(`Failed to call API with secret ${secret}`),
      })
    );
    const logString = JSON.stringify(record);
    expect(logString).not.toContain(secret);
    const errObj = record.error as { message: string };
    expect(errObj.message).toBe("Failed to call API with secret [REDACTED]");
  });

  it("redacts bare tokens completely from Error.stack", () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
    const err = new Error("connection failure");
    err.stack = `Error: connection failure\n    at authHandler (token: ${secret} line 42)`;

    const record = captureErrorLogLine(() => logger.error({ event: "test.event", error: err }));
    const logString = JSON.stringify(record);
    expect(logString).not.toContain(secret);
    const errObj = record.error as { stack?: string };
    expect(errObj.stack).toContain("token: [REDACTED] line 42");
  });

  it("redacts bare tokens completely from nested ordinary string fields", () => {
    const secret = "AIzaSyD_TEST_GOOGLE_API_KEY_1234567890";
    const record = captureLogLine(() =>
      logger.info({
        event: "test.event",
        metadata: {
          ordinaryField: `Found key ${secret} inside nested config`,
        },
      })
    );
    const logString = JSON.stringify(record);
    expect(logString).not.toContain(secret);
    const meta = record.metadata as { ordinaryField: string };
    expect(meta.ordinaryField).toBe("Found key [REDACTED] inside nested config");
  });

  it("does not redact ordinary, non-secret-shaped messages", () => {
    const record = captureLogLine(() =>
      logger.info({ event: "project.created", message: "My First Video", projectId: "proj_123" })
    );
    expect(record.message).toBe("My First Video");
    expect(record.projectId).toBe("proj_123");
  });
});
