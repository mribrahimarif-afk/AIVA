import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createBrandRepository } from "@/repositories/brand.repository";
import { createProductRepository } from "@/repositories/product.repository";
import { createContentBlobRepository } from "@/repositories/content-blob.repository";
import { createSceneRepository } from "@/repositories/scene.repository";
import { createDirectorPlanRepository } from "@/repositories/director-plan.repository";
import { createAssetRepository } from "@/repositories/asset.repository";
import { GeminiDirectorProvider } from "@/providers/ai/gemini-director.provider";
import { getEnv } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/logging/logger";
import { createProjectService } from "./project.service";
import { createBrandService } from "./brand.service";
import { createProductService } from "./product.service";
import { createVaultService } from "./vault.service";
import { createHealthService } from "./health.service";
import { createDirectorService } from "./director.service";

/**
 * Composition root wiring Prisma-backed repositories to application services.
 */
export const repositories = {
  project: createProjectRepository(prisma),
  brand: createBrandRepository(prisma),
  product: createProductRepository(prisma),
  contentBlob: createContentBlobRepository(prisma),
  scene: createSceneRepository(prisma),
  directorPlan: createDirectorPlanRepository(prisma),
  asset: createAssetRepository(prisma),
};

const env = getEnv();
export const directorAiProvider = new GeminiDirectorProvider({
  apiKey: env.GEMINI_API_KEY,
  model: env.GEMINI_MODEL,
  timeoutMs: env.GEMINI_TIMEOUT_MS,
});

export const services = {
  project: createProjectService({ projectRepository: repositories.project, db: prisma }),
  brand: createBrandService(repositories.brand),
  product: createProductService(repositories.product, repositories.brand),
  vault: createVaultService(
    repositories.asset,
    repositories.contentBlob,
    repositories.brand,
    repositories.product
  ),
  health: createHealthService(prisma),
  director: createDirectorService({
    directorPlanRepository: repositories.directorPlan,
    projectRepository: repositories.project,
    brandRepository: repositories.brand,
    productRepository: repositories.product,
    directorAiProvider,
    logger,
    maxScriptChars: env.DIRECTOR_MAX_SCRIPT_CHARS,
  }),
};

