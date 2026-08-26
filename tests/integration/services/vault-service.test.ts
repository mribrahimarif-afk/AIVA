import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { ValidationError } from "@/domain/errors";

describe("Integration — Vault & Brand & Product Services", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("creates brands and handles duplicate slug rejection", async () => {
    const brand = await services.brand.createBrand({ name: "Nike", slug: "nike" });
    expect(brand.id).toBeDefined();
    expect(brand.name).toBe("Nike");
    expect(brand.slug).toBe("nike");

    await expect(services.brand.createBrand({ name: "Nike Dup", slug: "nike" })).rejects.toThrow(
      ValidationError
    );
  });

  it("creates products under brands with alias management", async () => {
    const brand = await services.brand.createBrand({ name: "Adidas", slug: "adidas" });
    const product = await services.product.createProduct({
      brandId: brand.id,
      name: "Ultraboost 5",
      slug: "ultraboost-5",
    });

    expect(product.id).toBeDefined();
    expect(product.brandId).toBe(brand.id);

    // Add alias
    const alias1 = await services.product.addAlias({
      productId: product.id,
      alias: "UB5",
    });
    expect(alias1.normalizedAlias).toBe("ub5");

    // Add duplicate normalized alias should throw ValidationError
    await expect(
      services.product.addAlias({ productId: product.id, alias: "ub5" })
    ).rejects.toThrow(ValidationError);
  });

  it("uploads an asset to AIVA Vault and deduplicates identical binary content", async () => {
    const brand = await services.brand.createBrand({ name: "Puma", slug: "puma" });
    const product = await services.product.createProduct({ brandId: brand.id, name: "Suede", slug: "suede" });
    const mp4Header = Buffer.from("00000018667479706d70343200000000", "hex");
    const sampleBuffer = Buffer.concat([mp4Header, Buffer.from("SAMPLE_BINARY_VIDEO_DATA_9999")]);

    // 1st Upload
    const result1 = await services.vault.uploadAsset({
      fileBuffer: sampleBuffer,
      originalFilename: "promo1.mp4",
      mimeType: "video/mp4",
      vaultRole: "PRODUCT_VIDEO",
      productId: product.id,
    });

    expect(result1.isDuplicate).toBe(false);
    expect(result1.asset.id).toBeDefined();
    expect(result1.asset.checksum).toBeDefined();
    expect(result1.asset.localPath).toContain("assets/blobs");

    // 2nd Upload with EXACT SAME BINARY CONTENT under different filename & title
    const result2 = await services.vault.uploadAsset({
      fileBuffer: sampleBuffer,
      originalFilename: "promo1_copy.mp4",
      mimeType: "video/mp4",
      vaultRole: "PRODUCT_VIDEO",
      productId: product.id,
      title: "Second Upload Title",
    });

    expect(result2.isDuplicate).toBe(true);
    expect(result2.asset.id).not.toBe(result1.asset.id);
    expect(result2.asset.blobId).toBe(result1.asset.blobId);
    expect(result2.asset.checksum).toBe(result1.asset.checksum);

    // Verify only ONE ContentBlob exists in database
    const blobCount = await prisma.contentBlob.count();
    expect(blobCount).toBe(1);

    // Verify TWO Asset records exist
    const assetCount = await prisma.asset.count();
    expect(assetCount).toBe(2);
  });

  it("rejects invalid role file extensions", async () => {
    const sampleBuffer = Buffer.from("EXEC_SCRIPT_DATA");
    const brand = await services.brand.createBrand({ name: "Puma Logo Brand", slug: "puma-logo" });
    await expect(
      services.vault.uploadAsset({
        fileBuffer: sampleBuffer,
        originalFilename: "script.sh",
        mimeType: "text/x-shellscript",
        vaultRole: "BRAND_LOGO",
        brandId: brand.id,
      })
    ).rejects.toThrow(ValidationError);
  });

  it("filters vault assets by role, brandId, and productId", async () => {
    const brand = await services.brand.createBrand({ name: "Reebok", slug: "reebok" });
    const product = await services.product.createProduct({
      brandId: brand.id,
      name: "Nano X",
      slug: "nano-x",
    });

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mp4Header = Buffer.from("00000018667479706d70343200000000", "hex");

    // Upload Logo
    await services.vault.uploadAsset({
      fileBuffer: Buffer.concat([pngHeader, Buffer.from("LOGO_DATA_1")]),
      originalFilename: "logo.png",
      mimeType: "image/png",
      vaultRole: "BRAND_LOGO",
      brandId: brand.id,
    });

    // Upload Product Video
    await services.vault.uploadAsset({
      fileBuffer: Buffer.concat([mp4Header, Buffer.from("VIDEO_DATA_1")]),
      originalFilename: "nano.mp4",
      mimeType: "video/mp4",
      vaultRole: "PRODUCT_VIDEO",
      productId: product.id,
    });

    // Filter by role
    const logos = await services.vault.listAssets({ role: "BRAND_LOGO" });
    expect(logos.length).toBe(1);
    expect(logos[0]!.originalFilename).toBe("logo.png");

    // Filter by product
    const productAssets = await services.vault.listAssets({ productId: product.id });
    expect(productAssets.length).toBe(1);
    expect(productAssets[0]!.originalFilename).toBe("nano.mp4");
  });
});
