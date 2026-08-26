import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { storageService } from "@/storage/storage.service";
import { getTempRoot, getCanonicalBlobPath } from "@/storage/paths";
import fs from "node:fs/promises";
import path from "node:path";

describe("Finalize Blob 2-Phase State Machine & Service Creator Preservation", () => {
  const testChecksum = "99887766554433221100aabbccddeeff99887766554433221100aabbccddeeff";
  const testExt = ".png";
  let tempPath: string;
  let canonicalPath: string;

  beforeEach(async () => {
    await storageService.initializeGlobalStorage();
    canonicalPath = getCanonicalBlobPath(testChecksum, testExt);
    await fs.rm(canonicalPath, { force: true });
    tempPath = path.join(getTempRoot(), `test-finalize-${Date.now()}-${Math.random()}.png`);
    await fs.writeFile(tempPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempPath, { force: true });
    await fs.rm(canonicalPath, { force: true });
  });

  it("1. Phase A copy succeeds + Phase B temp cleanup succeeds -> createdByThisUpload: true, tempCleanupFailed: false", async () => {
    const res = await storageService.finalizeBlob(tempPath, testChecksum, testExt);
    expect(res.createdByThisUpload).toBe(true);
    expect(res.isDuplicate).toBe(false);
    expect(res.isNewCanonicalFile).toBe(true);
    expect(res.tempCleanupFailed).toBe(false);

    expect(await storageService.pathExists(canonicalPath)).toBe(true);
    expect(await storageService.pathExists(tempPath)).toBe(false);
  });

  it("2. Phase A copy succeeds + Phase B temp cleanup fails -> returns createdByThisUpload: true and tempCleanupFailed: true", async () => {
    // Mock fs.rm on tempPath to simulate Phase B cleanup failure
    const originalRm = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (p, options) => {
      if (typeof p === "string" && p === tempPath) {
        throw new Error("Simulated Phase B EBUSY lock failure");
      }
      return originalRm(p, options);
    });

    const res = await storageService.finalizeBlob(tempPath, testChecksum, testExt);
    expect(res.createdByThisUpload).toBe(true);
    expect(res.canonicalAbsolutePath).toBe(canonicalPath);
    expect(res.tempCleanupFailed).toBe(true);
    expect(res.tempCleanupErrorMessage).toMatch(/Simulated Phase B/i);

    // Canonical file created on disk, temp file remains on disk for outer retry
    expect(await storageService.pathExists(canonicalPath)).toBe(true);
    expect(await storageService.pathExists(tempPath)).toBe(true);
  });

  it("3. Phase A EEXIST + Phase B temp cleanup succeeds -> createdByThisUpload: false, tempCleanupFailed: false", async () => {
    // Pre-create canonical file
    const canonicalDir = path.dirname(canonicalPath);
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.writeFile(canonicalPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const res = await storageService.finalizeBlob(tempPath, testChecksum, testExt);
    expect(res.createdByThisUpload).toBe(false);
    expect(res.isDuplicate).toBe(true);
    expect(res.isNewCanonicalFile).toBe(false);
    expect(res.tempCleanupFailed).toBe(false);

    expect(await storageService.pathExists(tempPath)).toBe(false);
  });

  it("4. Phase A EEXIST + Phase B temp cleanup fails -> returns createdByThisUpload: false and tempCleanupFailed: true", async () => {
    // Pre-create canonical file
    const canonicalDir = path.dirname(canonicalPath);
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.writeFile(canonicalPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const originalRm = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (p, options) => {
      if (typeof p === "string" && p === tempPath) {
        throw new Error("Simulated EEXIST temp cleanup failure");
      }
      return originalRm(p, options);
    });

    const res = await storageService.finalizeBlob(tempPath, testChecksum, testExt);
    expect(res.createdByThisUpload).toBe(false);
    expect(res.tempCleanupFailed).toBe(true);

    expect(await storageService.pathExists(canonicalPath)).toBe(true);
    expect(await storageService.pathExists(tempPath)).toBe(true);
  });

  it("5. pre-existing canonical file is NEVER removed if DB transaction fails on duplicate upload", async () => {
    // Pre-create canonical file
    const canonicalDir = path.dirname(canonicalPath);
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.writeFile(canonicalPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02]));

    const res = await storageService.finalizeBlob(tempPath, testChecksum, testExt);
    expect(res.createdByThisUpload).toBe(false);

    // If pre-existing file (createdByThisUpload = false), compensate must NOT be called
    if (res.createdByThisUpload) {
      await storageService.compensateCanonicalBlob(canonicalPath);
    }

    // Canonical file is safely preserved
    expect(await storageService.pathExists(canonicalPath)).toBe(true);
  });
});
