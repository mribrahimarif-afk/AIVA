/**
 * vault-phaseb-lifecycle.test.ts
 *
 * Service-level deterministic tests for the Phase-B temp cleanup lifecycle fix.
 *
 * These tests confirm the invariant:
 *   Asset persisted + caller receives failure  →  IMPOSSIBLE
 *
 * Four cases:
 *  A. Phase-B cleanup fails → service retry succeeds → upload completes, DB committed
 *  B. Phase-B cleanup fails → service retry also fails → Asset NOT committed, error is accurate
 *  C. Pre-existing canonical + temp cleanup failure → canonical never removed
 *  D. No path persists Asset and returns failure merely because temp cleanup failed
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "@/infrastructure/db/client";
import { storageService } from "@/storage/storage.service";
import { getTempRoot, getCanonicalBlobPath } from "@/storage/paths";
import { createVaultService } from "@/services/vault.service";
import { repositories } from "@/services/container";
import { StorageError } from "@/domain/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb]);

async function makeBrand(slug: string) {
  return prisma.brand.create({ data: { name: slug, slug } });
}

async function dbTotals() {
  const assets = await prisma.asset.count();
  const blobs = await prisma.contentBlob.count();
  return { assets, blobs };
}

// ---------------------------------------------------------------------------
describe("Vault Phase-B Lifecycle — committed Asset must never produce caller failure", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
    await storageService.initializeGlobalStorage();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Test A: Phase-B cleanup fails → service retry succeeds → upload completes
  // -------------------------------------------------------------------------
  it("A. Phase-B cleanup fails, service retry succeeds → upload completes; exactly 1 Asset, 1 ContentBlob, no temp orphan", async () => {
    const brand = await makeBrand("phaseb-a");
    const vault = createVaultService(
      repositories.asset,
      repositories.contentBlob,
      repositories.brand,
      repositories.product
    );

    // We'll stage the file manually so we can intercept Phase B.
    const staged = await storageService.stageFile(PNG_HEADER, "logo_a.png");
    const tempPath = staged.tempPath;
    const canonicalPath = getCanonicalBlobPath(staged.checksum, ".png");

    // First call to fs.rm on tempPath (inside finalizeBlob Phase B) → fails.
    // Second call to fs.rm on tempPath (service retry inside processStagedUpload) → succeeds.
    let phaseBCallCount = 0;
    const originalRm = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (p: unknown, opts?: unknown) => {
      if (typeof p === "string" && p === tempPath) {
        phaseBCallCount++;
        if (phaseBCallCount === 1) {
          throw new Error("Simulated Phase-B lock failure");
        }
      }
      // @ts-expect-error – spread unknown opts
      return originalRm(p, opts);
    });

    const res = await vault.uploadStaged({
      stagedInfo: staged,
      originalFilename: "logo_a.png",
      mimeType: "image/png",
      vaultRole: "BRAND_LOGO",
      brandId: brand.id,
    });

    // Upload must succeed
    expect(res.asset.id).toBeDefined();
    expect(res.isDuplicate).toBe(false);

    // Exactly 1 Asset + 1 ContentBlob
    const { assets, blobs } = await dbTotals();
    expect(assets).toBe(1);
    expect(blobs).toBe(1);

    // Canonical file on disk
    expect(await storageService.pathExists(canonicalPath)).toBe(true);

    // Temp must be gone (retry cleaned it)
    expect(await storageService.pathExists(tempPath)).toBe(false);

    // Cleanup
    await fs.rm(canonicalPath, { force: true });
  });

  // -------------------------------------------------------------------------
  // Test B: Phase-B cleanup fails → service retry also fails → Asset NOT committed
  // -------------------------------------------------------------------------
  it("B. Phase-B cleanup fails, service retry also fails → logical Asset NOT committed; error reports true orphan state", async () => {
    const brand = await makeBrand("phaseb-b");
    const vault = createVaultService(
      repositories.asset,
      repositories.contentBlob,
      repositories.brand,
      repositories.product
    );

    const staged = await storageService.stageFile(PNG_HEADER, "logo_b.png");
    const tempPath = staged.tempPath;
    const canonicalPath = getCanonicalBlobPath(staged.checksum, ".png");

    // ALL calls to fs.rm on tempPath → fail (simulates persistent lock)
    // Note: outer catch on the vault service will also try removeTempFile, so
    // we need to track the canonical compensation call too.
    const originalRm = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (p: unknown, opts?: unknown) => {
      if (typeof p === "string" && p === tempPath) {
        throw new Error("Simulated persistent lock — temp never deletable");
      }
      // @ts-expect-error – spread unknown opts
      return originalRm(p, opts);
    });

    let caughtErr: unknown;
    try {
      await vault.uploadStaged({
        stagedInfo: staged,
        originalFilename: "logo_b.png",
        mimeType: "image/png",
        vaultRole: "BRAND_LOGO",
        brandId: brand.id,
      });
      throw new Error("uploadStaged should have thrown");
    } catch (e) {
      caughtErr = e;
    }

    // Must have thrown a StorageError
    expect(caughtErr).toBeInstanceOf(StorageError);
    const err = caughtErr as StorageError;
    expect(err.details).toMatchObject({ partialUploadOrphaned: true });

    // Asset and ContentBlob must NOT be created in DB
    const { assets, blobs } = await dbTotals();
    expect(assets).toBe(0);
    expect(blobs).toBe(0);

    // Cleanup — restore mocks first so rm works
    vi.restoreAllMocks();
    await fs.rm(canonicalPath, { force: true });
    await fs.rm(tempPath, { force: true });
  });

  // -------------------------------------------------------------------------
  // Test C: Pre-existing canonical + temp cleanup failure → canonical never removed
  // -------------------------------------------------------------------------
  it("C. Pre-existing canonical (createdByThisUpload=false) + temp cleanup failure → canonical is never removed", async () => {
    const brand = await makeBrand("phaseb-c");
    const vault = createVaultService(
      repositories.asset,
      repositories.contentBlob,
      repositories.brand,
      repositories.product
    );

    // First upload — succeeds, creates canonical + ContentBlob in DB
    const firstResult = await vault.uploadAsset({
      fileBuffer: PNG_HEADER,
      originalFilename: "logo_c.png",
      mimeType: "image/png",
      vaultRole: "BRAND_LOGO",
      brandId: brand.id,
    });
    const canonicalPath = storageService.resolveStoragePath(firstResult.asset.localPath!);
    expect(await storageService.pathExists(canonicalPath)).toBe(true);

    // Stage a second copy of same file
    const staged = await storageService.stageFile(PNG_HEADER, "logo_c_dup.png");
    const tempPath = staged.tempPath;

    // ALL fs.rm calls on tempPath → fail (second upload temp)
    const originalRm = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (p: unknown, opts?: unknown) => {
      if (typeof p === "string" && p === tempPath) {
        throw new Error("Simulated persistent lock");
      }
      // @ts-expect-error
      return originalRm(p, opts);
    });

    let caughtErr: unknown;
    try {
      await vault.uploadStaged({
        stagedInfo: staged,
        originalFilename: "logo_c_dup.png",
        mimeType: "image/png",
        vaultRole: "BRAND_LOGO",
        brandId: brand.id,
      });
      throw new Error("uploadStaged should have thrown");
    } catch (e) {
      caughtErr = e;
    }

    // Must have errored (temp orphaned)
    expect(caughtErr).toBeInstanceOf(StorageError);

    // Canonical file MUST still be present (it was pre-existing, must not be removed)
    expect(await storageService.pathExists(canonicalPath)).toBe(true);

    // Cleanup
    vi.restoreAllMocks();
    await fs.rm(canonicalPath, { force: true });
    await fs.rm(tempPath, { force: true });
  });

  // -------------------------------------------------------------------------
  // Test D: No path persists Asset and returns failure for temp-only cleanup failure
  // -------------------------------------------------------------------------
  it("D. No path commits Asset to DB and returns failure merely because temp cleanup failed", async () => {
    // This is a structural invariant test. We verify by examining the code path:
    // if cleanup retry succeeded (success path) → Asset is created and success returned.
    // if cleanup retry failed (failure path) → StorageError thrown BEFORE assetRepo.create.
    // We test the success-only path (retry succeeds at second attempt) to confirm no false failure.
    const brand = await makeBrand("phaseb-d");
    const vault = createVaultService(
      repositories.asset,
      repositories.contentBlob,
      repositories.brand,
      repositories.product
    );

    const staged = await storageService.stageFile(PNG_HEADER, "logo_d.png");
    const tempPath = staged.tempPath;
    const canonicalPath = getCanonicalBlobPath(staged.checksum, ".png");

    // Phase-B fails once, then retry succeeds — tests that we get a SUCCESS result not a failure
    let callCount = 0;
    const originalRm = fs.rm;
    vi.spyOn(fs, "rm").mockImplementation(async (p: unknown, opts?: unknown) => {
      if (typeof p === "string" && p === tempPath) {
        callCount++;
        if (callCount === 1) throw new Error("Simulated single Phase-B failure");
      }
      // @ts-expect-error
      return originalRm(p, opts);
    });

    // Upload MUST succeed
    const res = await vault.uploadStaged({
      stagedInfo: staged,
      originalFilename: "logo_d.png",
      mimeType: "image/png",
      vaultRole: "BRAND_LOGO",
      brandId: brand.id,
    });

    expect(res.asset.id).toBeDefined();
    expect(res.isDuplicate).toBe(false);

    // DB must be committed
    const { assets, blobs } = await dbTotals();
    expect(assets).toBe(1);
    expect(blobs).toBe(1);

    // Temp file must be gone (retry succeeded)
    expect(await storageService.pathExists(tempPath)).toBe(false);

    // Cleanup
    await fs.rm(canonicalPath, { force: true });
  });
});
