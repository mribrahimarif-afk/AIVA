import type { PrismaClient } from "@prisma/client";
import type { Asset, AssetType, AssetSource, VaultRole } from "@/domain/asset";
import { toAsset } from "./mappers";

export interface CreateAssetRecord {
  title?: string | null;
  originalFilename?: string | null;
  type: AssetType;
  vaultRole?: VaultRole | null;
  source: AssetSource;
  localPath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  metadata?: Record<string, unknown> | null;
  projectId?: string | null;
  brandId?: string | null;
  productId?: string | null;
  blobId?: string | null;
}

export interface VaultAssetFilter {
  role?: VaultRole;
  brandId?: string;
  productId?: string;
}

export interface AssetRepository {
  create(input: CreateAssetRecord): Promise<Asset>;
  findById(id: string): Promise<Asset | null>;
  findByProjectId(projectId: string): Promise<Asset[]>;
  findByBrandId(brandId: string): Promise<Asset[]>;
  findByProductId(productId: string): Promise<Asset[]>;
  findByChecksum(checksum: string): Promise<Asset[]>;
  filterVault(filter?: VaultAssetFilter): Promise<Asset[]>;
  count(): Promise<number>;
}

export function createAssetRepository(db: PrismaClient): AssetRepository {
  return {
    async create(input) {
      const row = await db.asset.create({
        data: {
          title: input.title ?? null,
          originalFilename: input.originalFilename ?? null,
          type: input.type,
          vaultRole: input.vaultRole ?? null,
          source: input.source,
          localPath: input.localPath ?? null,
          mimeType: input.mimeType ?? null,
          sizeBytes: input.sizeBytes ?? null,
          checksum: input.checksum ?? null,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          projectId: input.projectId ?? null,
          brandId: input.brandId ?? null,
          productId: input.productId ?? null,
          blobId: input.blobId ?? null,
        },
      });
      return toAsset(row);
    },

    async findById(id) {
      const row = await db.asset.findUnique({ where: { id } });
      return row ? toAsset(row) : null;
    },

    async findByProjectId(projectId) {
      const rows = await db.asset.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toAsset);
    },

    async findByBrandId(brandId) {
      const rows = await db.asset.findMany({
        where: { brandId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toAsset);
    },

    async findByProductId(productId) {
      const rows = await db.asset.findMany({
        where: { productId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toAsset);
    },

    async findByChecksum(checksum) {
      const rows = await db.asset.findMany({
        where: { checksum },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toAsset);
    },

    async filterVault(filter = {}) {
      const whereClause: Record<string, unknown> = {};
      if (filter.role) {
        whereClause.vaultRole = filter.role;
      }
      if (filter.brandId) {
        whereClause.brandId = filter.brandId;
      }
      if (filter.productId) {
        whereClause.productId = filter.productId;
      }

      const rows = await db.asset.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toAsset);
    },

    async count() {
      return db.asset.count();
    },
  };
}
