import path from "node:path";
import { getEnv } from "@/infrastructure/config/env";
import { StorageError } from "@/domain/errors";

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
export const GLOBAL_STORAGE_DIRS = ["brands", "assets", "cache", "temp"] as const;

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CHECKSUM_PATTERN = /^[a-fA-F0-9]{64}$/;

function assertSafeSegment(segment: string, label: string): void {
  if (!segment || !PROJECT_ID_PATTERN.test(segment)) {
    throw new StorageError(`Invalid ${label}: "${segment}"`);
  }
}

export function getStorageRoot(): string {
  const env = getEnv();
  const rawRoot = path.isAbsolute(env.AIVA_STORAGE_ROOT)
    ? path.normalize(env.AIVA_STORAGE_ROOT)
    : path.resolve(process.cwd(), env.AIVA_STORAGE_ROOT);
  return path.normalize(rawRoot);
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
    throw new StorageError(`Invalid SHA-256 checksum format: "${checksum}"`);
  }
  const prefix = checksum.substring(0, 2).toLowerCase();
  const cleanExt = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  if (cleanExt.includes("/") || cleanExt.includes("\\") || cleanExt.includes("..")) {
    throw new StorageError(`Invalid file extension: "${extension}"`);
  }
  return path.join(getBlobsRoot(), prefix, `${checksum.toLowerCase()}${cleanExt}`);
}

/**
 * Converts an absolute filesystem path under storage root to a normalized, POSIX-style storage-relative path.
 * Throws a StorageError if the path escapes or lies outside the storage root.
 */
export function toStorageRelativePath(absolutePath: string): string {
  const root = getStorageRoot();
  const normalizedAbs = path.normalize(absolutePath);

  const rel = path.relative(root, normalizedAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new StorageError(`Path '${absolutePath}' escapes storage root '${root}'`, {
      absolutePath,
      storageRoot: root,
    });
  }

  // Ensure sibling directory with matching prefix fails (e.g. /storage-evil vs /storage)
  if (normalizedAbs.length > root.length) {
    const nextChar = normalizedAbs.charAt(root.length);
    if (nextChar !== path.sep) {
      throw new StorageError(
        `Path '${absolutePath}' lies in sibling directory outside storage root '${root}'`,
        { absolutePath, storageRoot: root }
      );
    }
  }

  return rel.replace(/\\/g, "/");
}

/**
 * Safely resolves a storage-relative path to an absolute path inside AIVA_STORAGE_ROOT.
 * Rejects ALL absolute path inputs (Windows or POSIX), path traversal (`../`), and outside-root escapes.
 */
export function resolveStoragePath(relativePath: string): string {
  if (!relativePath || typeof relativePath !== "string") {
    throw new StorageError("Relative storage path must be a non-empty string");
  }

  if (
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath)
  ) {
    throw new StorageError(
      `Invalid storage relative path: absolute paths are not permitted in Vault storage resolution ('${relativePath}')`,
      { relativePath }
    );
  }

  const root = getStorageRoot();
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new StorageError(
      `Relative storage path '${relativePath}' escapes storage root '${root}'`,
      { relativePath, storageRoot: root }
    );
  }

  return resolved;
}
