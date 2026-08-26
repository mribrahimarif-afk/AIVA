import path from "node:path";
import { getEnv } from "@/infrastructure/config/env";

/**
 * Per-project subdirectories created under storage/projects/{id}/ on
 * project creation.
 */
export const PROJECT_WORKSPACE_SUBDIRS = [
  "source",
  "audio",
  "stock",
  "product",
  "ai",
  "captions",
  "timeline",
  "renders",
  "temp",
] as const;

export type ProjectWorkspaceSubdir = (typeof PROJECT_WORKSPACE_SUBDIRS)[number];

/** Top-level directories that must exist regardless of any project. */
export const GLOBAL_STORAGE_DIRS = ["brands", "assets", "cache", "temp"] as const;

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CHECKSUM_PATTERN = /^[a-fA-F0-9]{64}$/;

function assertSafeSegment(segment: string, label: string): void {
  if (!segment || !PROJECT_ID_PATTERN.test(segment)) {
    throw new Error(`Invalid ${label}: "${segment}"`);
  }
}

/**
 * Resolves the configured storage root to an absolute, OS-native path.
 * A relative AIVA_STORAGE_ROOT is resolved against the current working
 * directory (the project root when run via `npm run dev`/`start`), so no
 * machine-specific path is ever hard-coded.
 */
export function getStorageRoot(): string {
  const env = getEnv();
  return path.isAbsolute(env.AIVA_STORAGE_ROOT)
    ? path.normalize(env.AIVA_STORAGE_ROOT)
    : path.resolve(process.cwd(), env.AIVA_STORAGE_ROOT);
}

export function getProjectsRoot(): string {
  return path.join(getStorageRoot(), "projects");
}

export function getProjectWorkspacePath(projectId: string): string {
  assertSafeSegment(projectId, "project id");
  return path.join(getProjectsRoot(), projectId);
}

export function getProjectSubdirPath(projectId: string, subdir: ProjectWorkspaceSubdir): string {
  return path.join(getProjectWorkspacePath(projectId), subdir);
}

export function getBrandsRoot(): string {
  return path.join(getStorageRoot(), "brands");
}

export function getAssetsRoot(): string {
  return path.join(getStorageRoot(), "assets");
}

export function getBlobsRoot(): string {
  return path.join(getAssetsRoot(), "blobs");
}

export function getCacheRoot(): string {
  return path.join(getStorageRoot(), "cache");
}

export function getTempRoot(): string {
  return path.join(getStorageRoot(), "temp");
}

export function getCanonicalBlobPath(checksum: string, extension: string): string {
  if (!checksum || !CHECKSUM_PATTERN.test(checksum)) {
    throw new Error(`Invalid SHA-256 checksum format: "${checksum}"`);
  }
  const prefix = checksum.substring(0, 2).toLowerCase();
  const cleanExt = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  if (cleanExt.includes("/") || cleanExt.includes("\\") || cleanExt.includes("..")) {
    throw new Error(`Invalid file extension: "${extension}"`);
  }
  return path.join(getBlobsRoot(), prefix, `${checksum.toLowerCase()}${cleanExt}`);
}

export function toStorageRelativePath(absolutePath: string): string {
  const root = getStorageRoot();
  const normalizedAbs = path.normalize(absolutePath);
  const normalizedRoot = path.normalize(root);

  if (normalizedAbs.startsWith(normalizedRoot)) {
    const rel = path.relative(normalizedRoot, normalizedAbs);
    return rel.replace(/\\/g, "/");
  }

  return absolutePath.replace(/\\/g, "/");
}

export function resolveStoragePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return path.normalize(relativePath);
  }
  return path.join(getStorageRoot(), relativePath);
}
