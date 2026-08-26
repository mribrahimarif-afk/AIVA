import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { GET as getContent } from "@/app/api/vault/[id]/content/route";

describe("Vault Content Streaming API — GET /api/vault/[id]/content", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("streams full file content (HTTP 200) when Range header is absent", async () => {
    const brand = await services.brand.createBrand({ name: "Preview Brand", slug: "preview-brand" });
    const product = await services.product.createProduct({ brandId: brand.id, name: "P1", slug: "p1" });
    const mp4Header = Buffer.from("00000018667479706d70343200000000", "hex");
    const payload = Buffer.concat([mp4Header, Buffer.from("PREVIEW_SAMPLE_PAYLOAD_CONTENT")]);

    const uploadRes = await services.vault.uploadAsset({
      fileBuffer: payload,
      originalFilename: "sample.mp4",
      mimeType: "video/mp4",
      vaultRole: "PRODUCT_VIDEO",
      productId: product.id,
    });

    const req = new NextRequest(`http://localhost/api/vault/${uploadRes.asset.id}/content`);
    const res = await getContent(req, { params: Promise.resolve({ id: uploadRes.asset.id }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-length")).toBe(String(payload.length));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("streams partial content (HTTP 206) for valid Range header", async () => {
    const brand = await services.brand.createBrand({ name: "Preview Brand 2", slug: "preview-brand-2" });
    const product = await services.product.createProduct({ brandId: brand.id, name: "P2", slug: "p2" });
    const mp4Header = Buffer.from("00000018667479706d70343200000000", "hex");
    const payload = Buffer.concat([mp4Header, Buffer.from("0123456789ABCDEF")]);

    const uploadRes = await services.vault.uploadAsset({
      fileBuffer: payload,
      originalFilename: "sample.mp4",
      mimeType: "video/mp4",
      vaultRole: "PRODUCT_VIDEO",
      productId: product.id,
    });

    const req = new NextRequest(`http://localhost/api/vault/${uploadRes.asset.id}/content`, {
      headers: { range: "bytes=0-9" },
    });

    const res = await getContent(req, { params: Promise.resolve({ id: uploadRes.asset.id }) });

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-9/${payload.length}`);
    expect(res.headers.get("content-length")).toBe("10");
  });

  it("returns HTTP 416 Range Not Satisfiable for out-of-bounds Range header", async () => {
    const brand = await services.brand.createBrand({ name: "Preview Brand 3", slug: "preview-brand-3" });
    const product = await services.product.createProduct({ brandId: brand.id, name: "P3", slug: "p3" });
    const mp4Header = Buffer.from("00000018667479706d70343200000000", "hex");
    const payload = Buffer.concat([mp4Header, Buffer.from("SHORT")]);

    const uploadRes = await services.vault.uploadAsset({
      fileBuffer: payload,
      originalFilename: "sample.mp4",
      mimeType: "video/mp4",
      vaultRole: "PRODUCT_VIDEO",
      productId: product.id,
    });

    const req = new NextRequest(`http://localhost/api/vault/${uploadRes.asset.id}/content`, {
      headers: { range: "bytes=9999-10000" },
    });

    const res = await getContent(req, { params: Promise.resolve({ id: uploadRes.asset.id }) });

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${payload.length}`);
  });
});
