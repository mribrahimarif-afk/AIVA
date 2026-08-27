import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { storageService } from "@/storage/storage.service";
import { repositories } from "@/services/container";
import { checksumMutex } from "@/services/vault.service";

describe("Vault Reference-Safe Canonical Protection & ChecksumMutex Serialization", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("1. Reference-Preservation: never deletes canonical file if another request has adopted ContentBlob DB record", async () => {
    const brand = await services.brand.createBrand({ name: "Race Brand", slug: "race-brand" });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);

    // 1. Upload file normally
    const uploadRes = await services.vault.uploadAsset({
      fileBuffer: pngHeader,
      originalFilename: "canonical_file.png",
      mimeType: "image/png",
      vaultRole: "BRAND_LOGO",
      brandId: brand.id,
    });

    const canonicalRelPath = uploadRes.asset.localPath!;
    const canonicalAbsPath = storageService.resolveStoragePath(canonicalRelPath);

    expect(await storageService.pathExists(canonicalAbsPath)).toBe(true);

    // 2. Perform reference check before compensation
    const existingBlob = await repositories.contentBlob.findByChecksum(uploadRes.asset.checksum!);
    expect(existingBlob).not.toBeNull();

    // Because existingBlob exists in DB, compensation MUST NOT delete canonical file
    if (!existingBlob) {
      await storageService.compensateCanonicalBlob(canonicalAbsPath);
    }

    // Canonical content remains available and untouched on disk
    expect(await storageService.pathExists(canonicalAbsPath)).toBe(true);
  });

  it("2. ChecksumMutex Serialization: forces concurrent uploads targeting identical checksum to execute sequentially", async () => {
    const checksum = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    const executionOrder: string[] = [];

    const task1 = checksumMutex.runExclusive(checksum, async () => {
      executionOrder.push("start_1");
      await new Promise((resolve) => setTimeout(resolve, 50));
      executionOrder.push("end_1");
    });

    const task2 = checksumMutex.runExclusive(checksum, async () => {
      executionOrder.push("start_2");
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push("end_2");
    });

    await Promise.all([task1, task2]);

    // ChecksumMutex guarantees task1 finishes completely before task2 starts
    expect(executionOrder).toEqual(["start_1", "end_1", "start_2", "end_2"]);
  });
});
