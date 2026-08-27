import { describe, it, expect } from "vitest";
import { detectFileSignature, normalizeMimeType } from "@/domain/asset/file-signature";
import { validateRoleFile } from "@/domain/asset/asset.schema";

describe("File Signature, 3-Way Format Consistency & SVG Removal", () => {
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

  it("rejects SVG files completely (SVG support removed)", () => {
    const svgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    const res = detectFileSignature(svgBuffer);
    expect(res.isValidSignature).toBe(false);

    expect(() =>
      validateRoleFile("logo.svg", "image/svg+xml", "BRAND_LOGO", svgBuffer)
    ).toThrow(/Forbidden file extension '\.svg'/i);
  });

  it("rejects 3-way format identity mismatches (PNG bytes named .jpg declared image/jpeg)", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() =>
      validateRoleFile("logo.jpg", "image/jpeg", "BRAND_LOGO", pngBuffer)
    ).toThrow(/File format identity mismatch/i);
  });

  it("rejects JPEG bytes named .png declared image/png", () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(() =>
      validateRoleFile("logo.png", "image/png", "BRAND_LOGO", jpegBuffer)
    ).toThrow(/File format identity mismatch/i);
  });

  it("allows valid extension aliases (.jpg vs .jpeg)", () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const res1 = validateRoleFile("photo.jpg", "image/jpeg", "BRAND_LOGO", jpegBuffer);
    expect(res1.detectedExt).toBe("jpg");

    const res2 = validateRoleFile("photo.jpeg", "image/jpeg", "BRAND_LOGO", jpegBuffer);
    expect(res2.detectedExt).toBe("jpg");
  });

  it("allows valid MIME aliases (audio/mpeg vs audio/mp3)", () => {
    const mp3Buffer = Buffer.from("ID3040000000000", "utf-8");
    const res1 = validateRoleFile("music.mp3", "audio/mpeg", "MUSIC", mp3Buffer);
    expect(res1.detectedExt).toBe("mp3");

    const res2 = validateRoleFile("music.mp3", "audio/mp3", "MUSIC", mp3Buffer);
    expect(res2.detectedExt).toBe("mp3");
  });

  it("safely normalizes MIME parameters (stripping ; charset=utf-8)", () => {
    expect(normalizeMimeType("image/png; charset=utf-8")).toBe("image/png");
    expect(normalizeMimeType("VIDEO/MP4 ; boundary=123")).toBe("video/mp4");
  });

  it("rejects renamed executables (MZ / PE binaries)", () => {
    const exeBuffer = Buffer.from("4d5a90000300000004000000ffff0000", "hex");
    const res = detectFileSignature(exeBuffer);
    expect(res.isValidSignature).toBe(false);

    expect(() =>
      validateRoleFile("logo.png", "image/png", "BRAND_LOGO", exeBuffer)
    ).toThrow(/signature check failed/i);
  });
});
