import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { PATCH as updateProductRoute, GET as getProductRoute } from "@/app/api/products/[id]/route";

describe("Product API & Update Service Integration", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("updates product name, slug, and description via PATCH endpoint", async () => {
    const brand = await services.brand.createBrand({ name: "Apple", slug: "apple" });
    const product = await services.product.createProduct({
      brandId: brand.id,
      name: "iPhone 15",
      slug: "iphone-15",
    });

    const patchReq = new NextRequest(`http://localhost/api/products/${product.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: "iPhone 15 Pro",
        slug: "iphone-15-pro",
        description: "Titanium design",
      }),
    });

    const res = await updateProductRoute(patchReq, { params: Promise.resolve({ id: product.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.product.name).toBe("iPhone 15 Pro");
    expect(data.product.slug).toBe("iphone-15-pro");
    expect(data.product.description).toBe("Titanium design");
  });

  it("rejects duplicate slug under the same brand", async () => {
    const brand = await services.brand.createBrand({ name: "Samsung", slug: "samsung" });
    await services.product.createProduct({ brandId: brand.id, name: "Galaxy S24", slug: "s24" });
    const p2 = await services.product.createProduct({ brandId: brand.id, name: "Galaxy Fold", slug: "fold" });

    const patchReq = new NextRequest(`http://localhost/api/products/${p2.id}`, {
      method: "PATCH",
      body: JSON.stringify({ slug: "s24" }),
    });

    const res = await updateProductRoute(patchReq, { params: Promise.resolve({ id: p2.id }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent product update", async () => {
    const patchReq = new NextRequest("http://localhost/api/products/nonexistent", {
      method: "PATCH",
      body: JSON.stringify({ name: "Ghost Product" }),
    });

    const res = await updateProductRoute(patchReq, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });
});
