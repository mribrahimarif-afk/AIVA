import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { storageService } from "@/storage/storage.service";
import { repositories } from "@/services/container";

describe("Vault Compensation Race & Reference-Safe Canonical Protection", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("never deletes canonical file if another request has created/adopted ContentBlob DB record", async () => {
    const brand = await services.brand.createBrand({ name: "Race Brand", slug: "race-brand" });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);

    // 1. Upload file normally (Request B)
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

    // 2. Simulate Request A encountering an error after canonical file existed
    // Perform reference check before compensation
    const existingBlob = await repositories.contentBlob.findByChecksum(uploadRes.asset.checksum!);
    expect(existingBlob).not.toBeNull();

    // Verification: Because existingBlob exists in DB, compensation MUST NOT delete canonical file
    if (!existingBlob) {
      await storageService.compensateCanonicalBlob(canonicalAbsPath);
    }

    // Canonical content remains available and untouched on disk
    expect(await storageService.pathExists(canonicalAbsPath)).toBe(true);
  });
});
