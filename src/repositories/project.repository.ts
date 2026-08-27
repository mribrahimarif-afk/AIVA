import type { PrismaClient } from "@prisma/client";
import type { Project, ProjectStatus, AspectRatio } from "@/domain/project";
import { toProject } from "./mappers";

export interface CreateProjectRecord {
  name: string;
  script: string;
  aspectRatio: AspectRatio;
}

export interface ProjectRepository {
  create(input: CreateProjectRecord): Promise<Project>;
  findById(id: string): Promise<Project | null>;
  findAll(): Promise<Project[]>;
  updateStatus(id: string, status: ProjectStatus): Promise<Project>;
  updateScript(id: string, script: string): Promise<Project>;
  count(): Promise<number>;
  countByStatus(status: ProjectStatus): Promise<number>;
}

export function createProjectRepository(db: PrismaClient): ProjectRepository {
  return {
    async create(input) {
      const row = await db.project.create({
        data: {
          name: input.name,
          script: input.script,
          aspectRatio: input.aspectRatio,
        },
      });
      return toProject(row);
    },

    async findById(id) {
      const row = await db.project.findUnique({ where: { id } });
      return row ? toProject(row) : null;
    },

    async findAll() {
      const rows = await db.project.findMany({ orderBy: { createdAt: "desc" } });
      return rows.map(toProject);
    },

    async updateStatus(id, status) {
      const row = await db.project.update({ where: { id }, data: { status } });
      return toProject(row);
    },

    async updateScript(id, script) {
      const row = await db.project.update({ where: { id }, data: { script } });
      return toProject(row);
    },

    async count() {
      return db.project.count();
    },

    async countByStatus(status) {
      return db.project.count({ where: { status } });
    },
  };
}
