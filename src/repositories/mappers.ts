import type { z } from "zod";
import type {
  Project as PrismaProject,
  Brand as PrismaBrand,
  Product as PrismaProduct,
  ProductAlias as PrismaProductAlias,
  ContentBlob as PrismaContentBlob,
  Scene as PrismaScene,
  Asset as PrismaAsset,
} from "@prisma/client";
import type { Project } from "@/domain/project";
import { aspectRatioSchema, projectStatusSchema } from "@/domain/project";
import type { Brand } from "@/domain/brand";
import type { Product, ProductAlias } from "@/domain/product";
import type { Scene } from "@/domain/scene";
import { sceneStatusSchema } from "@/domain/scene";
import type { Asset, ContentBlob } from "@/domain/asset";
import { assetSourceSchema, assetTypeSchema, vaultRoleSchema } from "@/domain/asset";
import { DataIntegrityError } from "@/domain/errors";

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, field: string, recordId: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DataIntegrityError(`Invalid persisted value for ${field}`, {
      recordId,
      field,
      value,
    });
  }
  return result.data;
}

export function toProject(row: PrismaProject): Project {
  return {
    id: row.id,
    name: row.name,
    script: row.script,
    status: parseOrThrow(projectStatusSchema, row.status, "Project.status", row.id),
    aspectRatio: parseOrThrow(aspectRatioSchema, row.aspectRatio, "Project.aspectRatio", row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toBrand(
  row: PrismaBrand & {
    products?: PrismaProduct[];
    assets?: PrismaAsset[];
  }
): Brand {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    products: row.products ? row.products.map(toProduct) : undefined,
    assets: row.assets ? row.assets.map(toAsset) : undefined,
  };
}

export function toProductAlias(row: PrismaProductAlias): ProductAlias {
  return {
    id: row.id,
    productId: row.productId,
    alias: row.alias,
    normalizedAlias: row.normalizedAlias,
    createdAt: row.createdAt,
  };
}

export function toProduct(
  row: PrismaProduct & {
    aliases?: PrismaProductAlias[];
  }
): Product {
  return {
    id: row.id,
    brandId: row.brandId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    aliases: row.aliases ? row.aliases.map(toProductAlias) : undefined,
  };
}

export function toContentBlob(row: PrismaContentBlob): ContentBlob {
  return {
    id: row.id,
    checksum: row.checksum,
    storagePath: row.storagePath,
    sizeBytes: row.sizeBytes,
    mimeType: row.mimeType,
    createdAt: row.createdAt,
  };
}

export function toScene(row: PrismaScene): Scene {
  return {
    id: row.id,
    projectId: row.projectId,
    sequence: row.sequence,
    text: row.text,
    status: parseOrThrow(sceneStatusSchema, row.status, "Scene.status", row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAsset(row: PrismaAsset): Asset {
  let parsedMetadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      parsedMetadata = JSON.parse(row.metadata) as Record<string, unknown>;
    } catch {
      throw new DataIntegrityError("Invalid JSON in persisted Asset metadata", {
        recordId: row.id,
        field: "Asset.metadata",
      });
    }
  }

  return {
    id: row.id,
    title: row.title ?? null,
    originalFilename: row.originalFilename ?? null,
    type: parseOrThrow(assetTypeSchema, row.type, "Asset.type", row.id),
    vaultRole: row.vaultRole
      ? parseOrThrow(vaultRoleSchema, row.vaultRole, "Asset.vaultRole", row.id)
      : null,
    source: parseOrThrow(assetSourceSchema, row.source, "Asset.source", row.id),
    localPath: row.localPath ?? null,
    mimeType: row.mimeType ?? null,
    sizeBytes: row.sizeBytes ?? null,
    checksum: row.checksum ?? null,
    metadata: parsedMetadata,
    projectId: row.projectId ?? null,
    brandId: row.brandId ?? null,
    productId: row.productId ?? null,
    blobId: row.blobId ?? null,
    createdAt: row.createdAt,
  };
}
