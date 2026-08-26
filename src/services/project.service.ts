import type { PrismaClient } from "@prisma/client";
import type { Project } from "@/domain/project";
import { createProjectSchema, projectIdSchema, type CreateProjectInput } from "@/domain/project";
import { NotFoundError, StorageError, ValidationError } from "@/domain/errors";
import type { ProjectRepository } from "@/repositories/project.repository";
import { storageService } from "@/storage/storage.service";
import { logger } from "@/infrastructure/logging/logger";

export interface ProjectService {
  createProject(input: unknown): Promise<Project>;
  getProject(id: string): Promise<Project>;
  listProjects(): Promise<Project[]>;
}

/** The one storage operation project creation depends on. Narrowed to an
 * interface (rather than depending on the concrete `storageService`
 * export) so tests can inject a fake that fails on demand, without
 * touching the real filesystem. */
export interface ProjectWorkspaceInitializer {
  initializeProjectWorkspace(projectId: string): Promise<string>;
}

/** The one database operation used for rollback. Narrowed to an
 * interface for the same reason as `storage` below — tests can inject a
 * `db` whose `project.delete` fails on demand to exercise the
 * rollback-failure path without needing a real broken database. */
export interface ProjectRollbackDb {
  project: { delete: PrismaClient["project"]["delete"] };
}

interface ProjectServiceDeps {
  projectRepository: ProjectRepository;
  db: ProjectRollbackDb;
  storage?: ProjectWorkspaceInitializer;
}

/**
 * Orchestrates project creation: validates input, persists the database
 * record, then initializes the on-disk workspace. If workspace creation
 * fails, the database record is rolled back so we never end up with a
 * project that has no storage to write into.
 *
 * If the rollback delete *itself* fails, that failure is never silently
 * swallowed: it's logged distinctly from the original workspace failure,
 * and a StorageError with `details.orphaned: true` is thrown so callers
 * (and anyone reading logs/health) can tell the difference between "the
 * project was cleanly rejected" and "manual cleanup is required."
 */
export function createProjectService({
  projectRepository,
  db,
  storage = storageService,
}: ProjectServiceDeps): ProjectService {
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
        await storage.initializeProjectWorkspace(project.id);
      } catch (workspaceError) {
        logger.error({
          event: "project.workspace_init_failed",
          projectId: project.id,
          error: workspaceError,
          message: "Rolling back project record after workspace init failure",
        });

        try {
          await db.project.delete({ where: { id: project.id } });
        } catch (rollbackError) {
          logger.error({
            event: "project.rollback_failed",
            projectId: project.id,
            error: rollbackError,
            message:
              "Failed to roll back project record after workspace init failure; project row is orphaned and requires manual cleanup",
          });
          throw new StorageError(
            "Failed to create the project workspace, and the database record could not be rolled back automatically",
            { projectId: project.id, orphaned: true }
          );
        }

        throw workspaceError;
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
