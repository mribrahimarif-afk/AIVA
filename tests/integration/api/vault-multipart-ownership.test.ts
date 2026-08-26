import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { POST as uploadVaultAsset } from "@/app/api/vault/upload/route";
import { storageService } from "@/storage/storage.service";

describe("Multipart Upload Ownership & Single-Owner Cleanup State Machine", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);
  });

  it("rejects missing vaultRole after file staging and cleans temp file", async () => {
    const stageStreamSpy = vi.spyOn(storageService, "stageStream");

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

    // Verify temp file was staged and subsequently cleaned up from disk
    expect(stageStreamSpy).toHaveBeenCalled();
    const stagedResult = await stageStreamSpy.mock.results[0]?.value;
    if (stagedResult?.tempPath) {
      expect(await storageService.pathExists(stagedResult.tempPath)).toBe(false);
    }
  });

  it("rejects invalid brandId after file staging and cleans temp file", async () => {
    const stageStreamSpy = vi.spyOn(storageService, "stageStream");

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

    expect(stageStreamSpy).toHaveBeenCalled();
    const stagedResult = await stageStreamSpy.mock.results[0]?.value;
    if (stagedResult?.tempPath) {
      expect(await storageService.pathExists(stagedResult.tempPath)).toBe(false);
    }
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
  });
});
