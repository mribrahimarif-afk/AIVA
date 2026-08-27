import { describe, it, expect } from "vitest";
import { normalizeAlias } from "@/domain/product/product.schema";

describe("Unicode & Urdu Product Alias Normalization", () => {
  it("normalizes hyphenated and spaced English/Roman Urdu aliases identically", () => {
    expect(normalizeAlias("Majoon-e-Adam")).toBe("majoon e adam");
    expect(normalizeAlias("Majoon e Adam")).toBe("majoon e adam");
    expect(normalizeAlias("  MAJOON   E   ADAM  ")).toBe("majoon e adam");
  });

  it("preserves Urdu script aliases and does not reduce them to blank", () => {
    const urduAlias = "مجون آدم";
    const normalized = normalizeAlias(urduAlias);
    expect(normalized).not.toBe("");
    expect(normalized).toBe("مجون آدم");
  });

  it("handles mixed English and Urdu characters correctly", () => {
    const mixed = "Product A - مجون آدم (v2.0)";
    expect(normalizeAlias(mixed)).toBe("product a مجون آدم v2 0");
  });
});
