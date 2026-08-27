import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { ValidationError, NotFoundError } from "@/domain/errors";

describe("Vault Ownership Rules & Invariants", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("requires brandId for BRAND_LOGO and rejects productId", async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

    // Missing brandId
    await expect(
      services.vault.uploadAsset({
        fileBuffer: pngBuffer,
        originalFilename: "logo.png",
        mimeType: "image/png",
        vaultRole: "BRAND_LOGO",
      })
    ).rejects.toThrow(ValidationError);

    const brand = await services.brand.createBrand({ name: "Nike", slug: "nike" });
    const product = await services.product.createProduct({
      brandId: brand.id,
      name: "Air Max",
      slug: "air-max",
    });

    // Providing productId for BRAND_LOGO
    await expect(
      services.vault.uploadAsset({
        fileBuffer: pngBuffer,
        originalFilename: "logo.png",
        mimeType: "image/png",
        vaultRole: "BRAND_LOGO",
        brandId: brand.id,
        productId: product.id,
      })
    ).rejects.toThrow(ValidationError);
  });

  it("requires productId for PRODUCT_VIDEO and enforces brandId matching", async () => {
    const mp4Buffer = Buffer.from("00000018667479706d70343200000000", "hex");

    // Missing productId
    await expect(
      services.vault.uploadAsset({
        fileBuffer: mp4Buffer,
        originalFilename: "video.mp4",
        mimeType: "video/mp4",
        vaultRole: "PRODUCT_VIDEO",
      })
    ).rejects.toThrow(ValidationError);

    const brand1 = await services.brand.createBrand({ name: "Brand 1", slug: "b1" });
    const brand2 = await services.brand.createBrand({ name: "Brand 2", slug: "b2" });
    const product1 = await services.product.createProduct({
      brandId: brand1.id,
      name: "P1",
      slug: "p1",
    });

    // Supplying conflicting brandId
    await expect(
      services.vault.uploadAsset({
        fileBuffer: mp4Buffer,
        originalFilename: "video.mp4",
        mimeType: "video/mp4",
        vaultRole: "PRODUCT_VIDEO",
        brandId: brand2.id,
        productId: product1.id,
      })
    ).rejects.toThrow(ValidationError);
  });
});
