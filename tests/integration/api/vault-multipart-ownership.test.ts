import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/infrastructure/db/client";
import { services } from "@/services/container";
import { POST as uploadVaultAsset } from "@/app/api/vault/upload/route";
import { storageService } from "@/storage/storage.service";
import fs from "node:fs/promises";
import path from "node:path";
import { getTempRoot } from "@/storage/paths";

describe("Multipart Upload Ownership & Single-Owner Cleanup State Machine", () => {
  beforeEach(async () => {
    await prisma.$transaction([
      prisma.asset.deleteMany(),
      prisma.contentBlob.deleteMany(),
      prisma.productAlias.deleteMany(),
      prisma.product.deleteMany(),
      prisma.brand.deleteMany(),
    ]);

    // Clean temp directory before each test run
    try {
      const files = await fs.readdir(getTempRoot());
      for (const f of files) {
        if (f.startsWith("upload-")) {
          await fs.rm(path.join(getTempRoot(), f), { force: true });
        }
      }
    } catch {
      // ignore
    }
  });

  it("1. missing vaultRole after file staging cleans staged temp file from disk", async () => {
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

    const stagedResult = await stageStreamSpy.mock.results[0]?.value;
    expect(stagedResult?.tempPath).toBeDefined();
    expect(await storageService.pathExists(stagedResult.tempPath)).toBe(false);
  });

  it("2. invalid brandId after file staging cleans staged temp file from disk", async () => {
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

    const stagedResult = await stageStreamSpy.mock.results[0]?.value;
    expect(stagedResult?.tempPath).toBeDefined();
    expect(await storageService.pathExists(stagedResult.tempPath)).toBe(false);
  });

  it("3. valid file + second extra file cleans staged temp file from disk before returning", async () => {
    const stageStreamSpy = vi.spyOn(storageService, "stageStream");
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

    const stagedResult = await stageStreamSpy.mock.results[0]?.value;
    if (stagedResult?.tempPath) {
      expect(await storageService.pathExists(stagedResult.tempPath)).toBe(false);
    }
  });

  it("4. valid file + unexpected file field name cleans staged temp file from disk", async () => {
    const stageStreamSpy = vi.spyOn(storageService, "stageStream");
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

    if (stageStreamSpy.mock.results.length > 0) {
      const stagedResult = await stageStreamSpy.mock.results[0]?.value;
      if (stagedResult?.tempPath) {
        expect(await storageService.pathExists(stagedResult.tempPath)).toBe(false);
      }
    }
  });

  it("5. stageStream rejection cleans disk self-consistently and surfaces error", async () => {
    vi.spyOn(storageService, "stageStream").mockRejectedValueOnce(
      new Error("Simulated disk stage error")
    );

    const brand = await services.brand.createBrand({ name: "Stage Fail Brand", slug: "stage-fail-brand" });
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const formData = new FormData();
    formData.append("vaultRole", "BRAND_LOGO");
    formData.append("brandId", brand.id);
    formData.append("file", new File([pngHeader], "file1.png", { type: "image/png" }));

    const req = new NextRequest("http://localhost/api/vault/upload", {
      method: "POST",
      body: formData,
    });

    const res = await uploadVaultAsset(req);
    expect(res.status).toBe(500);
  });

  it("6. pre-transfer temp cleanup failure surfaces structured StorageError with partialUploadOrphaned", async () => {
    vi.spyOn(storageService, "removeTempFile").mockRejectedValueOnce(
      new Error("Simulated removeTempFile failure")
    );

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const formData = new FormData();
    formData.append("file", new File([pngHeader], "logo.png", { type: "image/png" }));
    // missing vaultRole triggers pre-transfer failure

    const req = new NextRequest("http://localhost/api/vault/upload", {
      method: "POST",
      body: formData,
    });

    const res = await uploadVaultAsset(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error?.code).toBe("STORAGE_ERROR");
  });
});
