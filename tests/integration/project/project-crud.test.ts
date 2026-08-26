import fs from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createProjectService } from "@/services/project.service";
import { getProjectWorkspacePath } from "@/storage/paths";
import { ValidationError, NotFoundError } from "@/domain/errors";

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

afterAll(async () => {
  await Promise.all(
    createdWorkspaceIds.map((id) => fs.rm(getProjectWorkspacePath(id), { recursive: true, force: true }))
  );
});
