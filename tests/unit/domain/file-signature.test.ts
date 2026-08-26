import { describe, it, expect } from "vitest";
import { detectFileSignature } from "@/domain/asset/file-signature";
import { validateRoleFile } from "@/domain/asset/asset.schema";

describe("File Signature & Magic Bytes Validation", () => {
  it("detects valid PNG magic bytes", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const res = detectFileSignature(pngBuffer);
    expect(res.isValidSignature).toBe(true);
    expect(res.detectedExt).toBe("png");
    expect(res.detectedMime).toBe("image/png");
  });

  it("detects valid JPEG magic bytes", () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const res = detectFileSignature(jpegBuffer);
    expect(res.isValidSignature).toBe(true);
    expect(res.detectedExt).toBe("jpg");
  });

  it("detects valid MP4 magic bytes", () => {
    const mp4Buffer = Buffer.from("00000018667479706d70343200000000", "hex");
    const res = detectFileSignature(mp4Buffer);
    expect(res.isValidSignature).toBe(true);
    expect(res.detectedExt).toBe("mp4");
  });

  it("detects valid MP3 magic bytes", () => {
    const mp3Buffer = Buffer.from("ID3040000000000", "utf-8");
    const res = detectFileSignature(mp3Buffer);
    expect(res.isValidSignature).toBe(true);
    expect(res.detectedExt).toBe("mp3");
  });

  it("detects valid SVG text payload and rejects active scripts/handlers", () => {
    const safeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>');
    const safeRes = detectFileSignature(safeSvg);
    expect(safeRes.isValidSignature).toBe(true);
    expect(safeRes.detectedExt).toBe("svg");

    const maliciousScriptSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const scriptRes = detectFileSignature(maliciousScriptSvg);
    expect(scriptRes.isValidSignature).toBe(false);
    expect(scriptRes.reason).toContain("script elements");

    const maliciousOnloadSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    const onloadRes = detectFileSignature(maliciousOnloadSvg);
    expect(onloadRes.isValidSignature).toBe(false);
    expect(onloadRes.reason).toContain("event handlers");
  });

  it("rejects renamed executables or arbitrary binary data", () => {
    const exeBuffer = Buffer.from("4d5a90000300000004000000ffff0000", "hex"); // Valid MZ PE executable magic bytes
    const res = detectFileSignature(exeBuffer);
    expect(res.isValidSignature).toBe(false);

    // Renamed executable logo.png
    expect(() =>
      validateRoleFile("logo.png", "image/png", "BRAND_LOGO", exeBuffer)
    ).toThrow(/signature check failed/i);
  });

  it("rejects extension and MIME mismatches", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Wrong MIME for BRAND_LOGO
    expect(() => validateRoleFile("logo.png", "video/mp4", "BRAND_LOGO", pngBuffer)).toThrow(
      /MIME type 'video\/mp4' is not permitted/i
    );

    // Extension mismatch for role
    expect(() => validateRoleFile("logo.mp4", "image/png", "BRAND_LOGO", pngBuffer)).toThrow(
      /File extension '\.mp4' is not permitted for role 'BRAND_LOGO'/i
    );
  });

  it("accepts valid extension, MIME, and matching signature", () => {
    const mp4Buffer = Buffer.from("00000018667479706d70343200000000", "hex");
    const result = validateRoleFile("promo.mp4", "video/mp4", "PRODUCT_VIDEO", mp4Buffer);
    expect(result.detectedExt).toBe("mp4");
  });

  it("does NOT allow application/octet-stream as a validation bypass for bad content", () => {
    const arbitraryPayload = Buffer.from("SOME_RANDOM_BINARY_DATA_NO_MAGIC");
    expect(() =>
      validateRoleFile("asset.png", "application/octet-stream", "BRAND_LOGO", arbitraryPayload)
    ).toThrow(/signature check failed/i);
  });
});
