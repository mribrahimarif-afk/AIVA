import type { z } from "zod";
import type {
  Project as PrismaProject,
  Brand as PrismaBrand,
  Scene as PrismaScene,
  Asset as PrismaAsset,
} from "@prisma/client";
import type { Project } from "@/domain/project";
import { aspectRatioSchema, projectStatusSchema } from "@/domain/project";
import type { Brand } from "@/domain/brand";
import type { Scene } from "@/domain/scene";
import { sceneStatusSchema } from "@/domain/scene";
import type { Asset } from "@/domain/asset";
import { assetSourceSchema, assetTypeSchema } from "@/domain/asset";
import { DataIntegrityError } from "@/domain/errors";

/**
 * Re-validates a value read back from the database against its domain
 * schema, rather than casting it. SQLite has no enum constraint on these
 * columns, so a corrupted or hand-edited row is the only way an invalid
 * value gets in — this is what turns that into a controlled application
 * error instead of a silently-wrong "valid" domain object.
 */
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

export function toBrand(row: PrismaBrand): Brand {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
  return {
    id: row.id,
    type: parseOrThrow(assetTypeSchema, row.type, "Asset.type", row.id),
    source: parseOrThrow(assetSourceSchema, row.source, "Asset.source", row.id),
    localPath: row.localPath,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    projectId: row.projectId,
    createdAt: row.createdAt,
  };
}
