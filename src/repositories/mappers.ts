import type { Project as PrismaProject, Brand as PrismaBrand, Scene as PrismaScene, Asset as PrismaAsset } from "@prisma/client";
import type { Project, AspectRatio, ProjectStatus } from "@/domain/project";
import type { Brand } from "@/domain/brand";
import type { Scene, SceneStatus } from "@/domain/scene";
import type { Asset, AssetType, AssetSource } from "@/domain/asset";

export function toProject(row: PrismaProject): Project {
  return {
    id: row.id,
    name: row.name,
    script: row.script,
    status: row.status as ProjectStatus,
    aspectRatio: row.aspectRatio as AspectRatio,
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
    status: row.status as SceneStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toAsset(row: PrismaAsset): Asset {
  return {
    id: row.id,
    type: row.type as AssetType,
    source: row.source as AssetSource,
    localPath: row.localPath,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    projectId: row.projectId,
    createdAt: row.createdAt,
  };
}
