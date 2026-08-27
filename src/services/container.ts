import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createBrandRepository } from "@/repositories/brand.repository";
import { createProductRepository } from "@/repositories/product.repository";
import { createContentBlobRepository } from "@/repositories/content-blob.repository";
import { createSceneRepository } from "@/repositories/scene.repository";
import { createAssetRepository } from "@/repositories/asset.repository";
import { createProjectService } from "./project.service";
import { createBrandService } from "./brand.service";
import { createProductService } from "./product.service";
import { createVaultService } from "./vault.service";
import { createHealthService } from "./health.service";

/**
 * Composition root wiring Prisma-backed repositories to application services.
 */
export const repositories = {
  project: createProjectRepository(prisma),
  brand: createBrandRepository(prisma),
  product: createProductRepository(prisma),
  contentBlob: createContentBlobRepository(prisma),
  scene: createSceneRepository(prisma),
  asset: createAssetRepository(prisma),
};

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
};
