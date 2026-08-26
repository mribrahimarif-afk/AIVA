import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { storageService } from "@/storage/storage.service";
import { getProjectWorkspacePath, PROJECT_WORKSPACE_SUBDIRS } from "@/storage/paths";
import { StorageError } from "@/domain/errors";

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

  it("removes a newly-created workspace entirely if a subdirectory fails partway through", async () => {
    const projectId = newProjectId();
    const workspacePath = getProjectWorkspacePath(projectId);
    const originalMkdir = fs.mkdir.bind(fs);

    let calls = 0;
    const spy = vi.spyOn(fs, "mkdir").mockImplementation(async (...args) => {
      calls += 1;
      // Let the workspace root (call 1) and first subdirectory (call 2)
      // succeed for real, then fail on the third call to simulate a
      // mid-way disk failure.
      if (calls === 3) {
        throw Object.assign(new Error("simulated ENOSPC"), { code: "ENOSPC" });
      }
      return originalMkdir(...(args as Parameters<typeof fs.mkdir>));
    });

    try {
      await expect(storageService.initializeProjectWorkspace(projectId)).rejects.toThrow(StorageError);
    } finally {
      spy.mockRestore();
    }

    // Nothing should be left behind: this call created the workspace
    // root, so failure must clean the whole tree up, not just stop
    // partway through it.
    await expect(fs.stat(workspacePath)).rejects.toThrow();
  });

  it("does not delete an already-existing workspace if a later re-init call fails", async () => {
    const projectId = newProjectId();
    const workspacePath = await storageService.initializeProjectWorkspace(projectId);

    const marker = path.join(workspacePath, "source", "keep-me.txt");
    await fs.writeFile(marker, "still here");

    const originalMkdir = fs.mkdir.bind(fs);
    const spy = vi.spyOn(fs, "mkdir").mockImplementation(async (...args) => {
      const target = String(args[0]);
      if (path.basename(target) === "temp") {
        throw Object.assign(new Error("simulated EACCES"), { code: "EACCES" });
      }
      return originalMkdir(...(args as Parameters<typeof fs.mkdir>));
    });

    try {
      await expect(storageService.initializeProjectWorkspace(projectId)).rejects.toThrow(StorageError);
    } finally {
      spy.mockRestore();
    }

    // The workspace pre-existed this call, so a failure partway through
    // re-initializing it must NOT delete the tree or the file already in it.
    const stat = await fs.stat(workspacePath);
    expect(stat.isDirectory()).toBe(true);
    expect(await fs.readFile(marker, "utf-8")).toBe("still here");
  });

  it("surfaces cleanup failure with partialWorkspaceOrphaned details if fs.rm fails after init failure", async () => {
    const projectId = newProjectId();
    const workspacePath = getProjectWorkspacePath(projectId);
    const originalMkdir = fs.mkdir.bind(fs);

    let calls = 0;
    const mkdirSpy = vi.spyOn(fs, "mkdir").mockImplementation(async (...args) => {
      calls += 1;
      // Succeed for workspace root (call 1), fail on subdirectory creation (call 2)
      if (calls === 2) {
        throw Object.assign(new Error("simulated init failure"), { code: "EIO" });
      }
      return originalMkdir(...(args as Parameters<typeof fs.mkdir>));
    });

    const rmSpy = vi
      .spyOn(fs, "rm")
      .mockRejectedValue(Object.assign(new Error("simulated cleanup failure EBUSY"), { code: "EBUSY" }));

    try {
      let thrownErr: StorageError | undefined;
      try {
        await storageService.initializeProjectWorkspace(projectId);
      } catch (err) {
        if (err instanceof StorageError) thrownErr = err;
      }

      expect(thrownErr).toBeInstanceOf(StorageError);
      expect(thrownErr?.details).toMatchObject({
        projectId,
        workspacePath,
        partialWorkspaceOrphaned: true,
      });
      expect(thrownErr?.message).toContain("cleanup of the partial workspace directory failed");
    } finally {
      mkdirSpy.mockRestore();
      rmSpy.mockRestore();
    }
  });

  it("fails safely and never calls fs.rm if fs.stat throws EACCES during workspace existence check", async () => {
    const projectId = newProjectId();
    const workspacePath = await storageService.initializeProjectWorkspace(projectId);
    const marker = path.join(workspacePath, "source", "protected-file.txt");
    await fs.writeFile(marker, "critical user data");

    const statSpy = vi
      .spyOn(fs, "stat")
      .mockRejectedValue(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));
    const rmSpy = vi.spyOn(fs, "rm");

    try {
      await expect(storageService.initializeProjectWorkspace(projectId)).rejects.toThrow(StorageError);
      expect(rmSpy).not.toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
      rmSpy.mockRestore();
    }

    // Verify existing workspace contents were NOT deleted
    const content = await fs.readFile(marker, "utf-8");
    expect(content).toBe("critical user data");
  });

  it("fails safely and never calls fs.rm if fs.stat throws EIO during workspace existence check", async () => {
    const projectId = newProjectId();
    const workspacePath = await storageService.initializeProjectWorkspace(projectId);
    const marker = path.join(workspacePath, "source", "important-file.txt");
    await fs.writeFile(marker, "do not erase");

    const statSpy = vi
      .spyOn(fs, "stat")
      .mockRejectedValue(Object.assign(new Error("EIO: i/o error"), { code: "EIO" }));
    const rmSpy = vi.spyOn(fs, "rm");

    try {
      await expect(storageService.initializeProjectWorkspace(projectId)).rejects.toThrow(StorageError);
      expect(rmSpy).not.toHaveBeenCalled();
    } finally {
      statSpy.mockRestore();
      rmSpy.mockRestore();
    }

    // Verify existing workspace contents were NOT deleted
    const content = await fs.readFile(marker, "utf-8");
    expect(content).toBe("do not erase");
  });

  it("treats ENOENT as genuinely missing and proceeds with normal workspace creation", async () => {
    const projectId = newProjectId();
    const workspacePath = getProjectWorkspacePath(projectId);

    // Confirm path genuinely does not exist (ENOENT)
    expect(await storageService.projectWorkspaceExists(projectId)).toBe(false);

    // Normal initialization works as expected
    const createdPath = await storageService.initializeProjectWorkspace(projectId);
    expect(createdPath).toBe(workspacePath);
    expect(await storageService.projectWorkspaceExists(projectId)).toBe(true);
  });

  it("surfaces StorageError in projectWorkspaceExists when stat fails with non-ENOENT error", async () => {
    const projectId = newProjectId();
    const statSpy = vi
      .spyOn(fs, "stat")
      .mockRejectedValue(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));

    try {
      await expect(storageService.projectWorkspaceExists(projectId)).rejects.toThrow(StorageError);
    } finally {
      statSpy.mockRestore();
    }
  });
});

describe("storageService.initializeGlobalStorage", () => {
  it("is safe to call multiple times (restart-safe)", async () => {
    await storageService.initializeGlobalStorage();
    await expect(storageService.initializeGlobalStorage()).resolves.toBeUndefined();
  });
});

describe("storageService.verifyWritable", () => {
  it("succeeds when the storage root is actually writable", async () => {
    await expect(storageService.verifyWritable()).resolves.toBeUndefined();
  });

  it("throws a StorageError when the write probe fails", async () => {
    const spy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }));

    try {
      await expect(storageService.verifyWritable()).rejects.toThrow(StorageError);
    } finally {
      spy.mockRestore();
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all(
    createdProjectIds.map((id) =>
      fs.rm(getProjectWorkspacePath(id), { recursive: true, force: true })
    )
  );
});
