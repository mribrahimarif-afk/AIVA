import { describe, it, expect } from "vitest";
import { createBrandSchema, slugify } from "@/domain/brand/brand.schema";
import { createProductSchema, normalizeAlias, addAliasSchema } from "@/domain/product/product.schema";
import { validateRoleFile, FORBIDDEN_EXTENSIONS } from "@/domain/asset/asset.schema";

describe("Domain — Brand & Product Schemas", () => {
  it("slugifies brand names correctly", () => {
    expect(slugify("Acme Corporation")).toBe("acme-corporation");
    expect(slugify("  My Brand 123!  ")).toBe("my-brand-123");
    expect(slugify("Special-Chars & Co.")).toBe("special-chars-co");
  });

  it("validates createBrandSchema", () => {
    const valid = createBrandSchema.safeParse({ name: "Acme", slug: "acme" });
    expect(valid.success).toBe(true);

    const invalidSlug = createBrandSchema.safeParse({ name: "Acme", slug: "Acme Corp!" });
    expect(invalidSlug.success).toBe(false);
  });

  it("normalizes product aliases deterministically", () => {
    expect(normalizeAlias("  Majoon-e-Adam  ")).toBe("majoon e adam");
    expect(normalizeAlias("MEA!")).toBe("mea");
    expect(normalizeAlias("Majoon   Adam")).toBe("majoon adam");
  });

  it("rejects blank or invalid alias inputs", () => {
    const blank = addAliasSchema.safeParse({ productId: "prod-1", alias: "   " });
    expect(blank.success).toBe(false);
  });

  it("validates role-specific file extensions", () => {
    expect(() => validateRoleFile("logo.png", "image/png", "BRAND_LOGO")).not.toThrow();
    expect(() => validateRoleFile("video.mp4", "video/mp4", "PRODUCT_VIDEO")).not.toThrow();
    expect(() => validateRoleFile("music.mp3", "audio/mpeg", "MUSIC")).not.toThrow();
    expect(() => validateRoleFile("font.ttf", "font/ttf", "FONT")).not.toThrow();

    // Mismatched or disallowed extension
    expect(() => validateRoleFile("document.pdf", "application/pdf", "BRAND_LOGO")).toThrow();
    expect(() => validateRoleFile("script.sh", "text/x-shellscript", "MUSIC")).toThrow();
  });

  it("strictly rejects forbidden executable extensions regardless of role", () => {
    for (const ext of FORBIDDEN_EXTENSIONS) {
      expect(() => validateRoleFile(`malicious${ext}`, "application/octet-stream", "BRAND_LOGO")).toThrow();
    }
  });
});
