import type { PrismaClient } from "@prisma/client";
import type { Scene } from "@/domain/scene";
import { toScene } from "./mappers";

export interface CreateSceneRecord {
  projectId: string;
  sequence: number;
  text: string;
}

export interface SceneRepository {
  create(input: CreateSceneRecord): Promise<Scene>;
  findByProjectId(projectId: string): Promise<Scene[]>;
}

export function createSceneRepository(db: PrismaClient): SceneRepository {
  return {
    async create(input) {
      const row = await db.scene.create({ data: input });
      return toScene(row);
    },

    async findByProjectId(projectId) {
      const rows = await db.scene.findMany({
        where: { projectId },
        orderBy: { sequence: "asc" },
      });
      return rows.map(toScene);
    },
  };
}
