import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { GET as getBrands, POST as createBrand } from "@/app/api/brands/route";
import { POST as createProduct } from "@/app/api/brands/[id]/products/route";
import { POST as addAlias } from "@/app/api/products/[id]/aliases/route";
import { POST as uploadVaultAsset } from "@/app/api/vault/upload/route";
import { GET as getVaultAssets } from "@/app/api/vault/route";

describe("API Integration — Brands, Products & Vault", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("handles GET and POST for /api/brands", async () => {
    const postReq = new NextRequest("http://localhost/api/brands", {
      method: "POST",
      body: JSON.stringify({ name: "Apple", slug: "apple" }),
    });

    const postRes = await createBrand(postReq);
    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    expect(postData.brand.name).toBe("Apple");

    const getRes = await getBrands();
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.brands.length).toBe(1);
  });

  it("handles product creation and alias additions via API", async () => {
    const brand = await services.brand.createBrand({ name: "Sony", slug: "sony" });

    const prodReq = new NextRequest(`http://localhost/api/brands/${brand.id}/products`, {
      method: "POST",
      body: JSON.stringify({ name: "PlayStation 5", slug: "ps5" }),
    });

    const prodRes = await createProduct(prodReq, { params: Promise.resolve({ id: brand.id }) });
    expect(prodRes.status).toBe(201);
    const prodData = await prodRes.json();

    const aliasReq = new NextRequest(`http://localhost/api/products/${prodData.product.id}/aliases`, {
      method: "POST",
      body: JSON.stringify({ alias: "PS5 Slim" }),
    });

    const aliasRes = await addAlias(aliasReq, { params: Promise.resolve({ id: prodData.product.id }) });
    expect(aliasRes.status).toBe(201);
    const aliasData = await aliasRes.json();
    expect(aliasData.alias.normalizedAlias).toBe("ps5 slim");
  });

  it("handles multipart file upload via /api/vault/upload", async () => {
    const brand = await services.brand.createBrand({ name: "LG", slug: "lg" });

    const formData = new FormData();
    const file = new File(["AUDIO_BINARY_STREAM_CONTENT"], "jingle.mp3", { type: "audio/mpeg" });
    formData.append("file", file);
    formData.append("vaultRole", "MUSIC");
    formData.append("brandId", brand.id);
    formData.append("title", "LG Jingle");

    const uploadReq = new NextRequest("http://localhost/api/vault/upload", {
      method: "POST",
      body: formData,
    });

    const uploadRes = await uploadVaultAsset(uploadReq);
    expect(uploadRes.status).toBe(201);
    const uploadData = await uploadRes.json();

    expect(uploadData.asset.vaultRole).toBe("MUSIC");
    expect(uploadData.asset.title).toBe("LG Jingle");
    expect(uploadData.isDuplicate).toBe(false);

    // Query /api/vault list endpoint
    const listReq = new NextRequest("http://localhost/api/vault?role=MUSIC");
    const listRes = await getVaultAssets(listReq);
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.assets.length).toBe(1);
  });
});
