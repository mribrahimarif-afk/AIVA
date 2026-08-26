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

  it("does not redact ordinary, non-secret-shaped messages", () => {
    const record = captureLogLine(() =>
      logger.info({ event: "project.created", message: "My First Video", projectId: "proj_123" })
    );
    expect(record.message).toBe("My First Video");
    expect(record.projectId).toBe("proj_123");
  });
});
