import { describe, expect, it } from "vitest";
import { prisma } from "@/infrastructure/db/client";

describe("SQLite initialization", () => {
  it("connects and can run a raw query", async () => {
    const result = await prisma.$queryRaw<Array<{ result: number | bigint }>>`SELECT 1 as result`;
    expect(Number(result[0]?.result)).toBe(1);
  });

  it("has created all four domain tables via migrations", async () => {
    const tables = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `;
    const names = tables.map((t) => t.name);

    expect(names).toContain("projects");
    expect(names).toContain("brands");
    expect(names).toContain("scenes");
    expect(names).toContain("assets");
  });

  it("enforces the projectId foreign key relationship on scenes", async () => {
    await expect(
      prisma.scene.create({
        data: { projectId: "does-not-exist", sequence: 0, text: "orphan scene" },
      })
    ).rejects.toThrow();
  });
});
