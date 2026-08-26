import { describe, expect, it } from "vitest";
import { createProjectSchema, projectStatusSchema, PROJECT_STATUSES } from "@/domain/project";

describe("createProjectSchema", () => {
  it("accepts a minimal valid project", () => {
    const result = createProjectSchema.safeParse({ name: "My Video" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.script).toBe("");
      expect(result.data.aspectRatio).toBe("9:16");
    }
  });

  it("rejects an empty name", () => {
    const result = createProjectSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing name", () => {
    const result = createProjectSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("trims whitespace-only names to empty and rejects them", () => {
    const result = createProjectSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a name longer than 200 characters", () => {
    const result = createProjectSchema.safeParse({ name: "a".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid aspect ratio", () => {
    const result = createProjectSchema.safeParse({ name: "Valid", aspectRatio: "4:3" });
    expect(result.success).toBe(false);
  });

  it("accepts each supported aspect ratio", () => {
    for (const ratio of ["9:16", "16:9", "1:1"]) {
      const result = createProjectSchema.safeParse({ name: "Valid", aspectRatio: ratio });
      expect(result.success).toBe(true);
    }
  });

  it("rejects a script over the size limit", () => {
    const result = createProjectSchema.safeParse({ name: "Valid", script: "a".repeat(50_001) });
    expect(result.success).toBe(false);
  });
});

describe("projectStatusSchema", () => {
  it("accepts every future-safe project status", () => {
    for (const status of PROJECT_STATUSES) {
      expect(projectStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    expect(projectStatusSchema.safeParse("NOT_A_STATUS").success).toBe(false);
  });

  it("contains exactly the statuses required by TASK-001", () => {
    expect(PROJECT_STATUSES).toEqual([
      "DRAFT",
      "SCRIPT_READY",
      "PLANNING",
      "PLAN_READY",
      "VOICE_GENERATING",
      "VOICE_READY",
      "ASSETS_RESOLVING",
      "ASSETS_READY",
      "AWAITING_AI_ASSET",
      "READY_TO_RENDER",
      "RENDERING",
      "COMPLETED",
      "FAILED",
    ]);
  });
});
