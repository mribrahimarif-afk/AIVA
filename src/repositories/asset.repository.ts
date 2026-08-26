import type { PrismaClient } from "@prisma/client";
import type { Asset, AssetType, AssetSource } from "@/domain/asset";
import { toAsset } from "./mappers";

export interface CreateAssetRecord {
  type: AssetType;
  source: AssetSource;
  localPath: string | null;
  metadata: Record<string, unknown> | null;
  projectId: string | null;
}

export interface AssetRepository {
  create(input: CreateAssetRecord): Promise<Asset>;
  findByProjectId(projectId: string): Promise<Asset[]>;
  count(): Promise<number>;
}

export function createAssetRepository(db: PrismaClient): AssetRepository {
  return {
    async create(input) {
      const row = await db.asset.create({
        data: {
          type: input.type,
          source: input.source,
          localPath: input.localPath,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          projectId: input.projectId,
        },
      });
      return toAsset(row);
    },

    async findByProjectId(projectId) {
      const rows = await db.asset.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toAsset);
    },

    async count() {
      return db.asset.count();
    },
  };
}
