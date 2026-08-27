/**
 * Asset categories, aligned with per-project storage workspace.
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
 * Explicit Vault classification concept representing what role an asset plays
 * within the permanent AIVA Vault library.
 */
export const VAULT_ROLES = [
  "BRAND_LOGO",
  "PRODUCT_VIDEO",
  "MUSIC",
  "SFX",
  "OUTRO",
  "FONT",
  "BROLL",
] as const;

export type VaultRole = (typeof VAULT_ROLES)[number];

export const ASSET_SOURCES = [
  "LOCAL_UPLOAD",
  "AI_GENERATED",
  "STOCK_PEXELS",
  "STOCK_PIXABAY",
  "VOICE_PROVIDER",
  "GENERATED",
] as const;

export type AssetSource = (typeof ASSET_SOURCES)[number];

export interface ContentBlob {
  id: string;
  checksum: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
}

export interface Asset {
  id: string;
  title: string | null;
  originalFilename: string | null;
  type: AssetType;
  vaultRole: VaultRole | null;
  source: AssetSource;
  localPath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  metadata: Record<string, unknown> | null;
  projectId: string | null;
  brandId: string | null;
  productId: string | null;
  blobId: string | null;
  createdAt: Date;
}
