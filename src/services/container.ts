import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createBrandRepository } from "@/repositories/brand.repository";
import { createSceneRepository } from "@/repositories/scene.repository";
import { createAssetRepository } from "@/repositories/asset.repository";
import { createProjectService } from "./project.service";
import { createHealthService } from "./health.service";

/**
 * Minimal composition root wiring the Prisma-backed repositories to the
 * application services. Kept as a plain object (no DI framework) since
 * the dependency graph is small and static for TASK-001.
 */
export const repositories = {
  project: createProjectRepository(prisma),
  brand: createBrandRepository(prisma),
  scene: createSceneRepository(prisma),
  asset: createAssetRepository(prisma),
};

export const services = {
  project: createProjectService({ projectRepository: repositories.project, db: prisma }),
  health: createHealthService(prisma),
};
