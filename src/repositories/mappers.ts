import type { z } from "zod";
import type {
  Project as PrismaProject,
  Brand as PrismaBrand,
  Product as PrismaProduct,
  ProductAlias as PrismaProductAlias,
  ContentBlob as PrismaContentBlob,
  Scene as PrismaScene,
  Asset as PrismaAsset,
  DirectorPlan as PrismaDirectorPlan,
  DirectorScene as PrismaDirectorScene,
} from "@prisma/client";
import type { Project } from "@/domain/project";
import { aspectRatioSchema, projectStatusSchema } from "@/domain/project";
import type { Brand } from "@/domain/brand";
import type { Product, ProductAlias } from "@/domain/product";
import type { Scene } from "@/domain/scene";
import { sceneStatusSchema } from "@/domain/scene";
import type { Asset, ContentBlob } from "@/domain/asset";
import { assetSourceSchema, assetTypeSchema, vaultRoleSchema } from "@/domain/asset";
import type { DirectorPlan, DirectorScene } from "@/domain/director";
import {
  directorLanguageSchema,
  directorContentTypeSchema,
  scenePurposeSchema,
  visualSourceHintSchema,
  shotTypeSchema,
  productPresenceSchema,
} from "@/domain/director";
import type {
  VoiceTrackAggregate,
  VoiceTrackDto,
  VoiceTrackWithBoundariesDto,
} from "@/domain/voice";
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

export function toDirectorScene(row: PrismaDirectorScene): DirectorScene {
  let parsedUnitIds: string[] = [];
  try {
    parsedUnitIds = JSON.parse(row.unitIds) as string[];
  } catch {
    throw new DataIntegrityError("Invalid JSON in persisted DirectorScene.unitIds", {
      recordId: row.id,
      field: "DirectorScene.unitIds",
    });
  }

  let parsedKeywords: string[] = [];
  try {
    parsedKeywords = JSON.parse(row.keywords) as string[];
  } catch {
    throw new DataIntegrityError("Invalid JSON in persisted DirectorScene.keywords", {
      recordId: row.id,
      field: "DirectorScene.keywords",
    });
  }

  return {
    id: row.id,
    directorPlanId: row.directorPlanId,
    order: row.order,
    text: row.text,
    unitIds: parsedUnitIds,
    purpose: parseOrThrow(scenePurposeSchema, row.purpose, "DirectorScene.purpose", row.id),
    visualBrief: row.visualBrief,
    visualSourceHint: parseOrThrow(
      visualSourceHintSchema,
      row.visualSourceHint,
      "DirectorScene.visualSourceHint",
      row.id
    ),
    shotType: parseOrThrow(shotTypeSchema, row.shotType, "DirectorScene.shotType", row.id),
    mood: row.mood,
    setting: row.setting,
    subject: row.subject,
    productPresence: parseOrThrow(
      productPresenceSchema,
      row.productPresence,
      "DirectorScene.productPresence",
      row.id
    ),
    searchQuery: row.searchQuery,
    keywords: parsedKeywords,
    manualAiPrompt: row.manualAiPrompt ?? null,
    sourceSpanStart: row.sourceSpanStart,
    sourceSpanEnd: row.sourceSpanEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toDirectorPlan(
  row: PrismaDirectorPlan & {
    scenes?: PrismaDirectorScene[];
  }
): DirectorPlan {
  return {
    id: row.id,
    projectId: row.projectId,
    originalScript: row.originalScript,
    scriptHash: row.scriptHash,
    unitizerVersion: row.unitizerVersion,
    schemaVersion: row.schemaVersion,
    promptVersion: row.promptVersion,
    model: row.model,
    language: parseOrThrow(
      directorLanguageSchema,
      row.language,
      "DirectorPlan.language",
      row.id
    ),
    contentType: parseOrThrow(
      directorContentTypeSchema,
      row.contentType,
      "DirectorPlan.contentType",
      row.id
    ),
    summary: row.summary,
    creativeDirection: row.creativeDirection,
    brandId: row.brandId ?? null,
    productId: row.productId ?? null,
    generatedAt: row.generatedAt,
    scenes: row.scenes ? row.scenes.map(toDirectorScene) : [],
  };
}

export function toVoiceTrackDto(
  aggregate: VoiceTrackAggregate,
  currentScriptHash: string
): VoiceTrackDto {
  const isStale = aggregate.sourceScriptHash !== currentScriptHash;
  return {
    id: aggregate.id,
    projectId: aggregate.projectId,
    directorPlanId: aggregate.directorPlanId,
    sourceScriptHash: aggregate.sourceScriptHash,
    provider: aggregate.provider,
    model: aggregate.model,
    voiceName: aggregate.voiceName,
    locale: aggregate.locale,
    outputFormat: aggregate.outputFormat,
    audioSha256: aggregate.audioSha256,
    audioByteCount: aggregate.audioByteCount,
    audioStorageRef: aggregate.audioStorageRef,
    durationMs: aggregate.durationMs,
    generatedAt: aggregate.generatedAt.toISOString(),
    state: isStale ? "STALE" : "CURRENT",
    boundaryCount: aggregate.boundaries.length,
    audioUrl: `/api/projects/${aggregate.projectId}/voice/audio`,
  };
}

export function toVoiceTrackWithBoundariesDto(
  aggregate: VoiceTrackAggregate,
  currentScriptHash: string,
  originalScript: string
): VoiceTrackWithBoundariesDto {
  const dto = toVoiceTrackDto(aggregate, currentScriptHash);
  return {
    ...dto,
    boundaries: aggregate.boundaries.map((b) => ({
      id: b.id,
      order: b.order,
      sourceStart: b.sourceStart,
      sourceEnd: b.sourceEnd,
      audioStartMs: b.audioStartMs,
      audioDurationMs: b.audioDurationMs,
      text: originalScript.slice(b.sourceStart, b.sourceEnd),
    })),
  };
}

