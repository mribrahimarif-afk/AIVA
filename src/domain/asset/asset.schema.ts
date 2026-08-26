import { z } from "zod";
import { ASSET_SOURCES, ASSET_TYPES } from "./asset.types";

export const assetTypeSchema = z.enum(ASSET_TYPES);
export const assetSourceSchema = z.enum(ASSET_SOURCES);

export const createAssetSchema = z.object({
  type: assetTypeSchema,
  source: assetSourceSchema,
  localPath: z.string().trim().min(1).nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
  projectId: z.string().trim().min(1).nullable().default(null),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
