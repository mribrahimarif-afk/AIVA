/**
 * Asset categories, aligned with the per-project storage workspace
 * subdirectories created by the storage service.
 */
export const ASSET_TYPES = [
  "SOURCE",
  "AUDIO",
  "STOCK",
  "PRODUCT",
  "AI",
  "CAPTION",
  "TIMELINE",
  "RENDER",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

/**
 * Where an asset originated. Provider-backed sources are listed here as
 * future-safe values even though no provider is implemented in TASK-001.
 */
export const ASSET_SOURCES = [
  "LOCAL_UPLOAD",
  "AI_GENERATED",
  "STOCK_PEXELS",
  "STOCK_PIXABAY",
  "VOICE_PROVIDER",
  "GENERATED",
] as const;

export type AssetSource = (typeof ASSET_SOURCES)[number];

export interface Asset {
  id: string;
  type: AssetType;
  source: AssetSource;
  localPath: string | null;
  metadata: Record<string, unknown> | null;
  projectId: string | null;
  createdAt: Date;
}
