import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAssetsRoot,
  getBrandsRoot,
  getCacheRoot,
  getProjectSubdirPath,
  getProjectWorkspacePath,
  getProjectsRoot,
  getStorageRoot,
  getTempRoot,
  resolveStoragePath,
  toStorageRelativePath,
  PROJECT_WORKSPACE_SUBDIRS,
} from "@/storage/paths";

describe("storage path handling & security containment", () => {
  it("resolves the storage root to an absolute path", () => {
    const root = getStorageRoot();
    expect(path.isAbsolute(root)).toBe(true);
  });

  it("nests projects, brands, assets, cache, and temp under the storage root", () => {
    const root = getStorageRoot();
    expect(getProjectsRoot()).toBe(path.join(root, "projects"));
    expect(getBrandsRoot()).toBe(path.join(root, "brands"));
    expect(getAssetsRoot()).toBe(path.join(root, "assets"));
    expect(getCacheRoot()).toBe(path.join(root, "cache"));
    expect(getTempRoot()).toBe(path.join(root, "temp"));
  });

  it("builds a project workspace path under storage/projects/{id}", () => {
    const workspace = getProjectWorkspacePath("proj_abc123");
    expect(workspace).toBe(path.join(getProjectsRoot(), "proj_abc123"));
  });

  it("builds every required project subdirectory path", () => {
    for (const subdir of PROJECT_WORKSPACE_SUBDIRS) {
      expect(getProjectSubdirPath("proj_abc123", subdir)).toBe(
        path.join(getProjectWorkspacePath("proj_abc123"), subdir)
      );
    }
  });

  it("rejects a project id containing path traversal segments", () => {
    expect(() => getProjectWorkspacePath("../../etc")).toThrow();
    expect(() => getProjectWorkspacePath("..")).toThrow();
    expect(() => getProjectWorkspacePath("a/b")).toThrow();
    expect(() => getProjectWorkspacePath("a\\b")).toThrow();
  });

  it("converts absolute path under storage root to normalized relative storage path", () => {
    const root = getStorageRoot();
    const absPath = path.join(root, "assets", "blobs", "e3", "sample.png");
    const rel = toStorageRelativePath(absPath);
    expect(rel).toBe("assets/blobs/e3/sample.png");
  });

  it("rejects absolute paths escaping storage root in toStorageRelativePath", () => {
    const root = getStorageRoot();
    const evilPath = path.resolve(root, "..", "outside.txt");
    expect(() => toStorageRelativePath(evilPath)).toThrow(/escapes storage root/i);
  });

  it("resolves valid relative paths inside storage root securely", () => {
    const resolved = resolveStoragePath("assets/blobs/ab/1234.mp4");
    expect(resolved).toBe(path.join(getStorageRoot(), "assets", "blobs", "ab", "1234.mp4"));
  });

  it("rejects ALL absolute path inputs in resolveStoragePath", () => {
    const root = getStorageRoot();
    const absPathUnderRoot = path.join(root, "assets", "blobs", "ab", "1234.mp4");
    expect(() => resolveStoragePath(absPathUnderRoot)).toThrow(/absolute paths are not permitted/i);
    expect(() => resolveStoragePath("C:\\AIVA\\storage\\assets\\blob.mp4")).toThrow(/absolute paths are not permitted/i);
    expect(() => resolveStoragePath("/home/user/aiva/storage/assets/blob.mp4")).toThrow(/absolute paths are not permitted/i);
  });

  it("rejects path traversal attempts in resolveStoragePath", () => {
    expect(() => resolveStoragePath("../../../etc/passwd")).toThrow();
    expect(() => resolveStoragePath("assets/../../secret")).toThrow();
  });

  it("rejects sibling prefix paths escaping storage root", () => {
    const root = getStorageRoot();
    const siblingEvilPath = `${root}-evil/payload.exe`;
    expect(() => toStorageRelativePath(siblingEvilPath)).toThrow(/sibling directory|escapes storage root/i);
  });
});
