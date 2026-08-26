import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { storageService } from "@/storage/storage.service";
import { getTempRoot, getCanonicalBlobPath } from "@/storage/paths";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

describe("Finalize Blob 2-Phase State Machine", () => {
  const testChecksum = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";
  const testExt = ".png";
  let tempPath: string;
  let canonicalPath: string;

  beforeEach(async () => {
    await storageService.initializeGlobalStorage();
    canonicalPath = getCanonicalBlobPath(testChecksum, testExt);
    await fs.rm(canonicalPath, { force: true });
    tempPath = path.join(getTempRoot(), `test-finalize-${Date.now()}.png`);
    await fs.writeFile(tempPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  afterEach(async () => {
    await fs.rm(tempPath, { force: true });
    await fs.rm(canonicalPath, { force: true });
  });

  it("Phase A copy succeeds + Phase B temp cleanup succeeds -> createdByThisUpload: true", async () => {
    const res = await storageService.finalizeBlob(tempPath, testChecksum, testExt);
    expect(res.createdByThisUpload).toBe(true);
    expect(res.isDuplicate).toBe(false);
    expect(res.isNewCanonicalFile).toBe(true);

    const canonicalExists = await storageService.pathExists(canonicalPath);
    expect(canonicalExists).toBe(true);

    const tempExists = await storageService.pathExists(tempPath);
    expect(tempExists).toBe(false);
  });

  it("Phase A EEXIST + Phase B temp cleanup succeeds -> createdByThisUpload: false", async () => {
    // Pre-create canonical file
    const canonicalDir = path.dirname(canonicalPath);
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.writeFile(canonicalPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const res = await storageService.finalizeBlob(tempPath, testChecksum, testExt);
    expect(res.createdByThisUpload).toBe(false);
    expect(res.isDuplicate).toBe(true);
    expect(res.isNewCanonicalFile).toBe(false);

    const tempExists = await storageService.pathExists(tempPath);
    expect(tempExists).toBe(false);
  });
});
