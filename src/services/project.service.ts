import type { PrismaClient } from "@prisma/client";
import type { Project } from "@/domain/project";
import { createProjectSchema, projectIdSchema, type CreateProjectInput } from "@/domain/project";
import { NotFoundError, ValidationError } from "@/domain/errors";
import type { ProjectRepository } from "@/repositories/project.repository";
import { storageService } from "@/storage/storage.service";
import { logger } from "@/infrastructure/logging/logger";

export interface ProjectService {
  createProject(input: unknown): Promise<Project>;
  getProject(id: string): Promise<Project>;
  listProjects(): Promise<Project[]>;
}

interface ProjectServiceDeps {
  projectRepository: ProjectRepository;
  /** Used only to roll back a project record if workspace init fails. */
  db: PrismaClient;
}

/**
 * Orchestrates project creation: validates input, persists the database
 * record, then initializes the on-disk workspace. If workspace creation
 * fails, the database record is rolled back so we never end up with a
 * project that has no storage to write into.
 */
export function createProjectService({ projectRepository, db }: ProjectServiceDeps): ProjectService {
  return {
    async createProject(rawInput: unknown): Promise<Project> {
      const parsed = createProjectSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw ValidationError.fromIssues(parsed.error.issues);
      }
      const input: CreateProjectInput = parsed.data;

      const project = await projectRepository.create({
        name: input.name,
        script: input.script,
        aspectRatio: input.aspectRatio,
      });

      try {
        await storageService.initializeProjectWorkspace(project.id);
      } catch (error) {
        logger.error({
          event: "project.workspace_init_failed",
          projectId: project.id,
          error,
          message: "Rolling back project record after workspace init failure",
        });
        await db.project.delete({ where: { id: project.id } }).catch(() => undefined);
        throw error;
      }

      logger.info({ event: "project.created", projectId: project.id, message: project.name });
      return project;
    },

    async getProject(rawId: unknown): Promise<Project> {
      const id = projectIdSchema.parse(rawId);
      const project = await projectRepository.findById(id);
      if (!project) {
        throw new NotFoundError(`Project not found: ${id}`);
      }
      return project;
    },

    async listProjects(): Promise<Project[]> {
      return projectRepository.findAll();
    },
  };
}
