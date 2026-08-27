import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { storageService } from "@/storage/storage.service";

describe("Vault Concurrency, Exclusive No-Clobber & Reference-Safe Compensation", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("handles concurrent Promise.all uploads of identical checksum payload safely without clobbering", async () => {
    const brand = await services.brand.createBrand({ name: "Concurrent Brand", slug: "concurrent-brand" });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb, 0xcc]);

    // Launch 5 simultaneous uploads of exact same binary content
    const uploadPromises = Array.from({ length: 5 }).map((_, idx) =>
      services.vault.uploadAsset({
        fileBuffer: pngHeader,
        originalFilename: `concurrent_${idx}.png`,
        mimeType: "image/png",
        vaultRole: "BRAND_LOGO",
        brandId: brand.id,
      })
    );

    const results = await Promise.all(uploadPromises);

    // Verify all 5 uploads succeeded
    expect(results.length).toBe(5);

    // Exactly one should report isDuplicate: false (the exclusive canonical creator)
    const newFileCount = results.filter((r) => !r.isDuplicate).length;
    const dupCount = results.filter((r) => r.isDuplicate).length;

    expect(newFileCount).toBe(1);
    expect(dupCount).toBe(4);

    // Verify only ONE ContentBlob row was persisted in SQLite DB
    const blobCount = await prisma.contentBlob.count();
    expect(blobCount).toBe(1);

    // Verify 5 Asset rows were created in SQLite DB
    const assetCount = await prisma.asset.count();
    expect(assetCount).toBe(5);

    // Verify physical file exists on disk
    const blobPath = results[0]!.asset.localPath!;
    const exists = await storageService.pathExists(storageService.resolveStoragePath(blobPath));
    expect(exists).toBe(true);
  });
});
