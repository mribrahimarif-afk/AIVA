import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { POST as uploadVaultAsset } from "@/app/api/vault/upload/route";
import { getTempRoot } from "@/storage/paths";
import fs from "node:fs/promises";
import path from "node:path";

async function countTempFiles(): Promise<number> {
  const tempDir = getTempRoot();
  try {
    const files = await fs.readdir(tempDir);
    return files.filter((f) => f.startsWith("upload-")).length;
  } catch {
    return 0;
  }
}

describe("Multipart Upload Ownership & Single-Owner Cleanup State Machine", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);

    // Clean temp directory before test
    const tempDir = getTempRoot();
    try {
      const files = await fs.readdir(tempDir);
      for (const f of files) {
        if (f.startsWith("upload-")) {
          await fs.rm(path.join(tempDir, f), { force: true });
        }
      }
    } catch {
      // ignored
    }
  });

  it("rejects missing vaultRole after file staging and cleans temp file", async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const formData = new FormData();
    const file = new File([pngHeader], "logo.png", { type: "image/png" });
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/vault/upload", {
      method: "POST",
      body: formData,
    });

    const res = await uploadVaultAsset(req);
    expect(res.status).toBe(400);

    const tempCount = await countTempFiles();
    expect(tempCount).toBe(0);
  });

  it("rejects invalid brandId after file staging and cleans temp file", async () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const formData = new FormData();
    formData.append("vaultRole", "BRAND_LOGO");
    formData.append("brandId", "nonexistent-brand-id");
    const file = new File([pngHeader], "logo.png", { type: "image/png" });
    formData.append("file", file);

    const req = new NextRequest("http://localhost/api/vault/upload", {
      method: "POST",
      body: formData,
    });

    const res = await uploadVaultAsset(req);
    expect(res.status).toBe(404);

    const tempCount = await countTempFiles();
    expect(tempCount).toBe(0);
  });

  it("rejects multiple file fields in single multipart request and cleans temp files", async () => {
    const brand = await services.brand.createBrand({ name: "Multi File Brand", slug: "multi-file-brand" });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const formData = new FormData();
    formData.append("vaultRole", "BRAND_LOGO");
    formData.append("brandId", brand.id);
    formData.append("file", new File([pngHeader], "file1.png", { type: "image/png" }));
    formData.append("file", new File([pngHeader], "file2.png", { type: "image/png" }));

    const req = new NextRequest("http://localhost/api/vault/upload", {
      method: "POST",
      body: formData,
    });

    const res = await uploadVaultAsset(req);
    expect(res.status).toBe(400);

    const tempCount = await countTempFiles();
    expect(tempCount).toBe(0);
  });

  it("rejects unexpected file field name (e.g. 'attachment') and cleans temp file", async () => {
    const brand = await services.brand.createBrand({ name: "FieldName Brand", slug: "fieldname-brand" });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const formData = new FormData();
    formData.append("vaultRole", "BRAND_LOGO");
    formData.append("brandId", brand.id);
    formData.append("attachment", new File([pngHeader], "file1.png", { type: "image/png" }));

    const req = new NextRequest("http://localhost/api/vault/upload", {
      method: "POST",
      body: formData,
    });

    const res = await uploadVaultAsset(req);
    expect(res.status).toBe(400);

    const tempCount = await countTempFiles();
    expect(tempCount).toBe(0);
  });
});
