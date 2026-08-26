import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { storageService } from "@/storage/storage.service";

describe("Vault Upload Atomicity, Compensation & Canonical Extensions", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("stores canonical payload under detected extension even if user provided another permitted extension", async () => {
    const brand = await services.brand.createBrand({ name: "Canonical Brand", slug: "canonical-brand" });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

    // Upload with .jpeg extension but PNG binary payload
    const res = await services.vault.uploadAsset({
      fileBuffer: pngHeader,
      originalFilename: "logo_misnamed.png",
      mimeType: "image/png",
      vaultRole: "BRAND_LOGO",
      brandId: brand.id,
    });

    expect(res.asset.localPath).toContain(".png");
    const exists = await storageService.pathExists(storageService.resolveStoragePath(res.asset.localPath!));
    expect(exists).toBe(true);
  });

  it("handles duplicate uploads with identical checksums safely without creating physical duplicate files", async () => {
    const brand = await services.brand.createBrand({ name: "Dedupe Brand", slug: "dedupe-brand" });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x99, 0x88]);

    const res1 = await services.vault.uploadAsset({
      fileBuffer: pngHeader,
      originalFilename: "file1.png",
      mimeType: "image/png",
      vaultRole: "BRAND_LOGO",
      brandId: brand.id,
    });

    const res2 = await services.vault.uploadAsset({
      fileBuffer: pngHeader,
      originalFilename: "file2.png",
      mimeType: "image/png",
      vaultRole: "BRAND_LOGO",
      brandId: brand.id,
    });

    expect(res1.isDuplicate).toBe(false);
    expect(res2.isDuplicate).toBe(true);
    expect(res1.asset.blobId).toBe(res2.asset.blobId);
    expect(res1.asset.checksum).toBe(res2.asset.checksum);
  });
});
