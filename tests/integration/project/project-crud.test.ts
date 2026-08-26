import fs from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createProjectService, type ProjectRollbackDb, type ProjectWorkspaceInitializer } from "@/services/project.service";
import { getProjectWorkspacePath } from "@/storage/paths";
import { ValidationError, NotFoundError, StorageError } from "@/domain/errors";

const projectRepository = createProjectRepository(prisma);
const projectService = createProjectService({ projectRepository, db: prisma });

const createdWorkspaceIds: string[] = [];

describe("Project repository CRUD", () => {
  it("creates a project with default status and persists all fields", async () => {
    const project = await projectRepository.create({
      name: "Repository Test Project",
      script: "Once upon a time...",
      aspectRatio: "16:9",
    });

    expect(project.id).toBeTruthy();
    expect(project.name).toBe("Repository Test Project");
    expect(project.script).toBe("Once upon a time...");
    expect(project.status).toBe("DRAFT");
    expect(project.aspectRatio).toBe("16:9");
    expect(project.createdAt).toBeInstanceOf(Date);

    const found = await projectRepository.findById(project.id);
    expect(found?.id).toBe(project.id);
  });

  it("returns null for a project that does not exist", async () => {
    const found = await projectRepository.findById("does-not-exist");
    expect(found).toBeNull();
  });

  it("lists all created projects", async () => {
    await projectRepository.create({ name: "List Test A", script: "", aspectRatio: "9:16" });
    await projectRepository.create({ name: "List Test B", script: "", aspectRatio: "9:16" });

    const all = await projectRepository.findAll();
    const names = all.map((p) => p.name);
    expect(names).toContain("List Test A");
    expect(names).toContain("List Test B");
  });

  it("updates project status", async () => {
    const project = await projectRepository.create({ name: "Status Test", script: "", aspectRatio: "9:16" });
    const updated = await projectRepository.updateStatus(project.id, "SCRIPT_READY");
    expect(updated.status).toBe("SCRIPT_READY");
  });

  it("counts projects overall and by status", async () => {
    const before = await projectRepository.count();
    await projectRepository.create({ name: "Count Test", script: "", aspectRatio: "9:16" });
    const after = await projectRepository.count();
    expect(after).toBe(before + 1);

    const completedBefore = await projectRepository.countByStatus("COMPLETED");
    expect(completedBefore).toBeGreaterThanOrEqual(0);
  });
});

describe("Project service (create + workspace initialization)", () => {
  it("creates a project record and its on-disk workspace together", async () => {
    const project = await projectService.createProject({
      name: "Service Test Project",
      script: "Scene one.",
      aspectRatio: "1:1",
    });
    createdWorkspaceIds.push(project.id);

    const persisted = await projectRepository.findById(project.id);
    expect(persisted).not.toBeNull();

    const workspaceStat = await fs.stat(getProjectWorkspacePath(project.id));
    expect(workspaceStat.isDirectory()).toBe(true);
  });

  it("rejects invalid input with a ValidationError before touching the database", async () => {
    const before = await projectRepository.count();

    await expect(projectService.createProject({ name: "" })).rejects.toBeInstanceOf(ValidationError);

    const after = await projectRepository.count();
    expect(after).toBe(before);
  });

  it("throws NotFoundError for a missing project", async () => {
    await expect(projectService.getProject("missing-project-id")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Project service rollback on workspace failure", () => {
  const alwaysFailingStorage: ProjectWorkspaceInitializer = {
    async initializeProjectWorkspace(): Promise<string> {
      throw new StorageError("simulated workspace failure");
    },
  };

  it("rolls back the project row and leaves no orphaned workspace when workspace init fails", async () => {
    let capturedProjectId: string | undefined;
    const capturingFailingStorage: ProjectWorkspaceInitializer = {
      async initializeProjectWorkspace(projectId: string): Promise<string> {
        capturedProjectId = projectId;
        throw new StorageError("simulated workspace failure");
      },
    };
    const serviceWithFailingStorage = createProjectService({
      projectRepository,
      db: prisma,
      storage: capturingFailingStorage,
    });

    await expect(
      serviceWithFailingStorage.createProject({ name: "Rollback Test", script: "", aspectRatio: "9:16" })
    ).rejects.toBeInstanceOf(StorageError);

    expect(capturedProjectId).toBeTruthy();

    // The DB row must be gone (rolled back)...
    const allProjects = await projectRepository.findAll();
    expect(allProjects.some((p) => p.name === "Rollback Test")).toBe(false);
    expect(await projectRepository.findById(capturedProjectId as string)).toBeNull();

    // ...and no directory should exist for that id on disk either,
    // proving this isn't just a DB-only rollback that leaves a
    // filesystem orphan behind.
    await expect(fs.stat(getProjectWorkspacePath(capturedProjectId as string))).rejects.toThrow();
  });

  it("surfaces (never swallows) a rollback failure as an orphaned-project error", async () => {
    const failingRollbackDb: ProjectRollbackDb = {
      project: {
        delete: (async () => {
          throw new Error("simulated database unavailable during rollback");
        }) as unknown as PrismaClient["project"]["delete"],
      },
    };
    const serviceWithBothFailing = createProjectService({
      projectRepository,
      db: failingRollbackDb,
      storage: alwaysFailingStorage,
    });

    let thrown: unknown;
    try {
      await serviceWithBothFailing.createProject({ name: "Orphan Test", script: "", aspectRatio: "9:16" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StorageError);
    expect((thrown as StorageError).details?.orphaned).toBe(true);

    // Because the simulated rollback failed, the row must still be
    // findable afterward — proving the failure was surfaced rather than
    // silently lost (a real, working `db.project.delete` would have
    // removed it, as proven by the previous test). Clean it up directly
    // via the real client since the service's own rollback couldn't.
    const rows = await projectRepository.findAll();
    const orphanRow = rows.find((p) => p.name === "Orphan Test");
    expect(orphanRow).toBeDefined();

    if (orphanRow) {
      await prisma.project.delete({ where: { id: orphanRow.id } });
    }
  });
});

afterAll(async () => {
  await Promise.all(
    createdWorkspaceIds.map((id) => fs.rm(getProjectWorkspacePath(id), { recursive: true, force: true }))
  );
});
