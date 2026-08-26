import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { POST as uploadVaultAsset } from "@/app/api/vault/upload/route";

describe("Streaming Upload API Integration — POST /api/vault/upload", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("handles true streaming multipart upload via POST /api/vault/upload", async () => {
    const brand = await services.brand.createBrand({ name: "Stream Brand", slug: "stream-brand" });

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload = Buffer.concat([pngHeader, Buffer.from("STREAMING_BINARY_DATA_CHUNK_999")]);

    const formData = new FormData();
    formData.append("vaultRole", "BRAND_LOGO");
    formData.append("brandId", brand.id);
    formData.append("title", "Streaming Logo Video");

    const file = new File([payload], "logo.png", { type: "image/png" });
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/vault/upload", {
      method: "POST",
      body: formData,
    });

    const res = await uploadVaultAsset(req);
    expect(res.status).toBe(201);
    const data = await res.json();

    expect(data.asset.id).toBeDefined();
    expect(data.asset.originalFilename).toBe("logo.png");
    expect(data.asset.title).toBe("Streaming Logo Video");
    expect(data.isDuplicate).toBe(false);
  });
});
