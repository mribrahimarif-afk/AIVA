import { z } from "zod";
import { ASSET_SOURCES, ASSET_TYPES, VAULT_ROLES, type VaultRole } from "./asset.types";
import { detectFileSignature, FORMAT_SPECS, normalizeMimeType } from "./file-signature";

export const assetTypeSchema = z.enum(ASSET_TYPES);
export const vaultRoleSchema = z.enum(VAULT_ROLES);
export const assetSourceSchema = z.enum(ASSET_SOURCES);

export const FORBIDDEN_EXTENSIONS = new Set([
  ".exe", ".sh", ".bat", ".cmd", ".js", ".mjs", ".cjs", ".ts", ".php", ".py", ".html", ".htm", ".ps1", ".vbs", ".jar", ".dll", ".so", ".bin", ".scr", ".pif", ".svg"
]);

export interface RoleFileRules {
  allowedExtensions: string[];
  allowedMimeTypes: string[];
  defaultAssetType: typeof ASSET_TYPES[number];
}

export const ROLE_FILE_RULES: Record<VaultRole, RoleFileRules> = {
  BRAND_LOGO: {
    allowedExtensions: [".png", ".jpg", ".jpeg", ".webp"],
    allowedMimeTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp"],
    defaultAssetType: "PRODUCT",
  },
  PRODUCT_VIDEO: {
    allowedExtensions: [".mp4", ".mov", ".webm"],
    allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
    defaultAssetType: "PRODUCT",
  },
  MUSIC: {
    allowedExtensions: [".mp3", ".wav", ".m4a"],
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/m4a"],
    defaultAssetType: "AUDIO",
  },
  SFX: {
    allowedExtensions: [".mp3", ".wav", ".m4a"],
    allowedMimeTypes: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/m4a"],
    defaultAssetType: "AUDIO",
  },
  OUTRO: {
    allowedExtensions: [".mp4", ".mov", ".webm", ".png", ".jpg", ".jpeg", ".webp"],
    allowedMimeTypes: [
      "video/mp4", "video/quicktime", "video/webm",
      "image/png", "image/jpeg", "image/jpg", "image/webp"
    ],
    defaultAssetType: "SOURCE",
  },
  FONT: {
    allowedExtensions: [".ttf", ".otf", ".woff", ".woff2"],
    allowedMimeTypes: [
      "font/ttf", "font/otf", "font/woff", "font/woff2",
      "application/x-font-ttf", "application/x-font-opentype",
      "application/font-woff", "application/font-woff2",
      "font/sfnt"
    ],
    defaultAssetType: "SOURCE",
  },
  BROLL: {
    allowedExtensions: [".mp4", ".mov", ".webm"],
    allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
    defaultAssetType: "STOCK",
  },
};

export function validateRoleFile(
  filename: string,
  declaredMime: string,
  role: VaultRole,
  fileBuffer?: Buffer
): { detectedExt: string; detectedMime: string } {
  const sanitizedName = filename.trim();
  const extIndex = sanitizedName.lastIndexOf(".");
  if (extIndex === -1) {
    throw new Error(`File '${filename}' has no file extension`);
  }

  const ext = sanitizedName.substring(extIndex).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    throw new Error(`Forbidden file extension '${ext}' is not permitted`);
  }

  const rules = ROLE_FILE_RULES[role];
  if (!rules) {
    throw new Error(`Invalid vault role '${role}'`);
  }

  if (!rules.allowedExtensions.includes(ext)) {
    throw new Error(
      `File extension '${ext}' is not permitted for role '${role}'. Allowed: ${rules.allowedExtensions.join(", ")}`
    );
  }

  const normalizedDeclaredMime = normalizeMimeType(declaredMime);

  if (
    normalizedDeclaredMime !== "application/octet-stream" &&
    !rules.allowedMimeTypes.includes(normalizedDeclaredMime)
  ) {
    throw new Error(`MIME type '${declaredMime}' is not permitted for role '${role}'`);
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    // Metadata-only validation
    return {
      detectedExt: ext.replace(".", ""),
      detectedMime: normalizedDeclaredMime,
    };
  }

  const signature = detectFileSignature(fileBuffer);
  if (!signature.isValidSignature || !signature.detectedExt) {
    throw new Error(
      `File content signature check failed for '${filename}': ${signature.reason || "Invalid content binary format"}`
    );
  }

  const spec = FORMAT_SPECS[signature.detectedExt];
  if (!spec) {
    throw new Error(`Unsupported content signature format '${signature.detectedExt}'`);
  }

  // 3-Way Format Consistency Verification
  // 1. Extension Consistency
  if (!spec.allowedExtensions.includes(ext)) {
    throw new Error(
      `File format identity mismatch for '${filename}': content signature detected '${signature.detectedExt}', but extension is '${ext}'`
    );
  }

  // 2. MIME Consistency
  if (
    normalizedDeclaredMime !== "application/octet-stream" &&
    !spec.allowedMimes.includes(normalizedDeclaredMime)
  ) {
    throw new Error(
      `File format identity mismatch for '${filename}': content signature detected '${signature.detectedExt}', but declared MIME is '${declaredMime}'`
    );
  }

  // 3. Vault Role Compatibility
  const canonicalExtDot = `.${spec.canonicalExt}`;
  if (
    !rules.allowedExtensions.includes(canonicalExtDot) &&
    !spec.allowedExtensions.some((e) => rules.allowedExtensions.includes(e))
  ) {
    throw new Error(
      `Detected file content format '${signature.detectedExt}' is not permitted for vault role '${role}'`
    );
  }

  return {
    detectedExt: spec.canonicalExt,
    detectedMime: signature.detectedMime || spec.allowedMimes[0]!,
  };
}

export const createAssetSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  originalFilename: z.string().trim().max(500).nullable().optional(),
  type: assetTypeSchema,
  vaultRole: vaultRoleSchema.nullable().optional(),
  source: assetSourceSchema,
  localPath: z.string().trim().min(1).nullable().default(null),
  mimeType: z.string().trim().max(200).nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  checksum: z.string().trim().length(64).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
  projectId: z.string().trim().min(1).nullable().default(null),
  brandId: z.string().trim().min(1).nullable().default(null),
  productId: z.string().trim().min(1).nullable().default(null),
  blobId: z.string().trim().min(1).nullable().default(null),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
