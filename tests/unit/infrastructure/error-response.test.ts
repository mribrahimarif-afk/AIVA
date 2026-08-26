import { describe, expect, it } from "vitest";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { StorageError, ValidationError, NotFoundError } from "@/domain/errors";

describe("toErrorResponse", () => {
  it("hides message and details for a 5xx server-fault error (StorageError)", async () => {
    const error = new StorageError("Failed to create directory: I:\\AIVA\\storage\\projects\\abc", {
      path: "I:\\AIVA\\storage\\projects\\abc",
      cause: "EACCES: permission denied, mkdir 'I:\\AIVA\\storage\\projects\\abc'",
    });

    const response = toErrorResponse(error);
    const body = (await response.json()) as { error: { message: string; details?: unknown } };

    expect(response.status).toBe(500);
    expect(body.error.message).not.toContain("I:\\AIVA\\storage");
    expect(body.error.message).not.toContain("EACCES");
    expect(body.error.details).toBeUndefined();
  });

  it("hides message and details for a 5xx DataIntegrity-style error generally", async () => {
    const error = new StorageError("Internal storage failure with sensitive path", {
      internalPath: "/etc/secret-config",
    });
    const response = toErrorResponse(error);
    const body = (await response.json()) as { error: { message: string; details?: unknown } };

    expect(JSON.stringify(body)).not.toContain("/etc/secret-config");
    expect(body.error.message).toBe("An internal error occurred");
  });

  it("keeps the real message and details for a 400 ValidationError", async () => {
    const error = ValidationError.fromIssues([{ path: ["name"], message: "Project name is required" }]);
    const response = toErrorResponse(error);
    const body = (await response.json()) as {
      error: { message: string; details?: { fieldErrors?: Record<string, string> } };
    };

    expect(response.status).toBe(400);
    expect(body.error.message).toBe("Validation failed");
    expect(body.error.details?.fieldErrors?.name).toBe("Project name is required");
  });

  it("keeps the real message for a 404 NotFoundError", async () => {
    const error = new NotFoundError("Project not found: abc123");
    const response = toErrorResponse(error);
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(404);
    expect(body.error.message).toBe("Project not found: abc123");
  });

  it("returns a generic 500 for a non-AivaError with no internal detail leaked", async () => {
    const error = new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2");
    const response = toErrorResponse(error);
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(500);
    expect(body.error.message).toBe("An internal error occurred");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
  });
});
