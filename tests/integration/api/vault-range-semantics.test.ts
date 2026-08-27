import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { GET as getContent } from "@/app/api/vault/[id]/content/route";

describe("HTTP Range Header RFC Semantics — GET /api/vault/[id]/content", () => {
  let assetId: string;
  const payloadLength = 36; // 16 bytes mp4 header hex + 20 bytes body string = 36 bytes total

  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);

    const brand = await services.brand.createBrand({ name: "Range Brand", slug: "range-brand" });
    const product = await services.product.createProduct({ brandId: brand.id, name: "P1", slug: "p1" });

    const mp4Header = Buffer.from("00000018667479706d70343200000000", "hex");
    const payload = Buffer.concat([mp4Header, Buffer.from("0123456789ABCDEF0123")]);

    const uploadRes = await services.vault.uploadAsset({
      fileBuffer: payload,
      originalFilename: "sample.mp4",
      mimeType: "video/mp4",
      vaultRole: "PRODUCT_VIDEO",
      productId: product.id,
    });

    assetId = uploadRes.asset.id;
  });

  it("handles standard range bytes=0-9 (HTTP 206)", async () => {
    const req = new NextRequest(`http://localhost/api/vault/${assetId}/content`, {
      headers: { range: "bytes=0-9" },
    });
    const res = await getContent(req, { params: Promise.resolve({ id: assetId }) });

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-9/${payloadLength}`);
    expect(res.headers.get("content-length")).toBe("10");
  });

  it("handles open range bytes=10- (HTTP 206)", async () => {
    const req = new NextRequest(`http://localhost/api/vault/${assetId}/content`, {
      headers: { range: "bytes=10-" },
    });
    const res = await getContent(req, { params: Promise.resolve({ id: assetId }) });

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 10-35/${payloadLength}`);
    expect(res.headers.get("content-length")).toBe("26");
  });

  it("handles suffix range bytes=-10 (HTTP 206 — last 10 bytes)", async () => {
    const req = new NextRequest(`http://localhost/api/vault/${assetId}/content`, {
      headers: { range: "bytes=-10" },
    });
    const res = await getContent(req, { params: Promise.resolve({ id: assetId }) });

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 26-35/${payloadLength}`);
    expect(res.headers.get("content-length")).toBe("10");
  });

  it("rejects invalid range bytes=- (HTTP 416)", async () => {
    const req = new NextRequest(`http://localhost/api/vault/${assetId}/content`, {
      headers: { range: "bytes=-" },
    });
    const res = await getContent(req, { params: Promise.resolve({ id: assetId }) });

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${payloadLength}`);
  });

  it("rejects out-of-bounds start >= size (HTTP 416)", async () => {
    const req = new NextRequest(`http://localhost/api/vault/${assetId}/content`, {
      headers: { range: "bytes=999-1000" },
    });
    const res = await getContent(req, { params: Promise.resolve({ id: assetId }) });

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${payloadLength}`);
  });

  it("rejects invalid end < start (HTTP 416)", async () => {
    const req = new NextRequest(`http://localhost/api/vault/${assetId}/content`, {
      headers: { range: "bytes=20-10" },
    });
    const res = await getContent(req, { params: Promise.resolve({ id: assetId }) });

    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${payloadLength}`);
  });

  it("clamps end > size to size - 1 (HTTP 206)", async () => {
    const req = new NextRequest(`http://localhost/api/vault/${assetId}/content`, {
      headers: { range: "bytes=20-999" },
    });
    const res = await getContent(req, { params: Promise.resolve({ id: assetId }) });

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 20-35/${payloadLength}`);
    expect(res.headers.get("content-length")).toBe("16");
  });
});
