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
  PROJECT_WORKSPACE_SUBDIRS,
} from "@/storage/paths";

describe("storage path handling", () => {
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

  it("defines exactly the subdirectories required by TASK-001", () => {
    expect(PROJECT_WORKSPACE_SUBDIRS).toEqual([
      "source",
      "audio",
      "stock",
      "product",
      "ai",
      "captions",
      "timeline",
      "renders",
      "temp",
    ]);
  });

  it("rejects a project id containing path traversal segments", () => {
    expect(() => getProjectWorkspacePath("../../etc")).toThrow();
    expect(() => getProjectWorkspacePath("..")).toThrow();
    expect(() => getProjectWorkspacePath("a/b")).toThrow();
    expect(() => getProjectWorkspacePath("a\\b")).toThrow();
  });

  it("rejects an empty project id", () => {
    expect(() => getProjectWorkspacePath("")).toThrow();
  });
});
