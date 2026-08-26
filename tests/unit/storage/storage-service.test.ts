import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { storageService } from "@/storage/storage.service";
import { getProjectWorkspacePath, PROJECT_WORKSPACE_SUBDIRS } from "@/storage/paths";

const createdProjectIds: string[] = [];

function newProjectId(): string {
  const id = `test-${randomUUID()}`;
  createdProjectIds.push(id);
  return id;
}

describe("storageService.initializeProjectWorkspace", () => {
  it("creates every required subdirectory for a new project", async () => {
    const projectId = newProjectId();
    const workspacePath = await storageService.initializeProjectWorkspace(projectId);

    expect(workspacePath).toBe(getProjectWorkspacePath(projectId));

    for (const subdir of PROJECT_WORKSPACE_SUBDIRS) {
      const stat = await fs.stat(path.join(workspacePath, subdir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it("is idempotent: re-running does not fail and preserves existing files", async () => {
    const projectId = newProjectId();
    const workspacePath = await storageService.initializeProjectWorkspace(projectId);

    const marker = path.join(workspacePath, "source", "keep-me.txt");
    await fs.writeFile(marker, "do not delete");

    await expect(storageService.initializeProjectWorkspace(projectId)).resolves.toBe(workspacePath);

    const content = await fs.readFile(marker, "utf-8");
    expect(content).toBe("do not delete");
  });

  it("reports workspace existence correctly", async () => {
    const projectId = newProjectId();
    expect(await storageService.projectWorkspaceExists(projectId)).toBe(false);

    await storageService.initializeProjectWorkspace(projectId);
    expect(await storageService.projectWorkspaceExists(projectId)).toBe(true);
  });
});

describe("storageService.initializeGlobalStorage", () => {
  it("is safe to call multiple times (restart-safe)", async () => {
    await storageService.initializeGlobalStorage();
    await expect(storageService.initializeGlobalStorage()).resolves.toBeUndefined();
  });
});

afterAll(async () => {
  await Promise.all(
    createdProjectIds.map((id) =>
      fs.rm(getProjectWorkspacePath(id), { recursive: true, force: true })
    )
  );
});
