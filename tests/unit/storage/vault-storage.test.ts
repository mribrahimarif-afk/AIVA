import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  getCanonicalBlobPath,
  toStorageRelativePath,
  resolveStoragePath,
  getStorageRoot,
} from "@/storage/paths";
import { storageService } from "@/storage/storage.service";

describe("Storage — Canonical Blob Paths & Staging", () => {
  const dummyChecksum = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("generates deterministic canonical blob paths", () => {
    const canonical = getCanonicalBlobPath(dummyChecksum, ".mp4");
    expect(canonical).toContain(path.join("assets", "blobs", "e3", `${dummyChecksum}.mp4`));
  });

  it("converts absolute paths to storage-relative paths", () => {
    const root = getStorageRoot();
    const absPath = path.join(root, "assets", "blobs", "e3", "dummy.mp4");
    const rel = toStorageRelativePath(absPath);
    expect(rel).toBe("assets/blobs/e3/dummy.mp4");
  });

  it("resolves storage-relative paths back to absolute paths", () => {
    const rel = "assets/blobs/e3/dummy.mp4";
    const resolved = resolveStoragePath(rel);
    expect(resolved).toBe(path.join(getStorageRoot(), rel));
  });

  it("stages files and computes SHA-256 checksum correctly", async () => {
    const content = Buffer.from("AIVA Vault Test Content 123");
    const expectedChecksum = crypto.createHash("sha256").update(content).digest("hex");

    const staged = await storageService.stageFile(content, "test-file.mp4");
    expect(staged.checksum).toBe(expectedChecksum);
    expect(staged.sizeBytes).toBe(content.length);
    expect(staged.extension).toBe(".mp4");

    // Verify temp file exists
    const exists = await storageService.pathExists(staged.tempPath);
    expect(exists).toBe(true);

    // Clean up
    await storageService.removeTempFile(staged.tempPath);
  });
});
