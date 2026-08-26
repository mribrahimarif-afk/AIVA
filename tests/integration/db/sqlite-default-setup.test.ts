import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { ensureSqliteParentDir } from "@/infrastructure/db/client";

describe("SQLite Default Local Setup & Parent Directory Auto-Creation Smoke Test", () => {
  const relDbPath = "./.test-sqlite-default-smoke/dev.db";
  const schemaDir = path.resolve(process.cwd(), "prisma");
  const absParentDir = path.resolve(schemaDir, ".test-sqlite-default-smoke");
  const absDbFile = path.resolve(schemaDir, relDbPath);

  beforeEach(() => {
    if (fs.existsSync(absParentDir)) {
      fs.rmSync(absParentDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(absParentDir)) {
      fs.rmSync(absParentDir, { recursive: true, force: true });
    }
  });

  it("proves production ensureSqliteParentDir prevents SQLite Error Code 14 on fresh clones", async () => {
    // 1. Verify parent directory is absent initially
    expect(fs.existsSync(absParentDir)).toBe(false);

    // 2. Simulate default .env configuration (DATABASE_URL="file:./.test-sqlite-default-smoke/dev.db")
    const testDbUrl = `file:${relDbPath}`;
    process.env.DATABASE_URL = testDbUrl;

    // 3. Call the REAL production helper directly from client.ts
    const resolvedAbsPath = ensureSqliteParentDir(testDbUrl);
    expect(resolvedAbsPath).toBe(absDbFile);

    // 4. Verify parent directory was created on disk
    expect(fs.existsSync(absParentDir)).toBe(true);

    // 5. Apply real Prisma migrations to the relative database path
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    execSync(`${npxCmd} prisma migrate deploy`, {
      env: { ...process.env, DATABASE_URL: testDbUrl },
      stdio: "pipe",
    });

    expect(fs.existsSync(absDbFile)).toBe(true);

    // 6. Connect PrismaClient and run Brand & Project queries
    const client = new PrismaClient({
      datasources: {
        db: { url: testDbUrl },
      },
    });

    try {
      const brand = await client.brand.create({
        data: { name: "Smoke Brand", slug: "smoke-brand" },
      });
      expect(brand.id).toBeDefined();

      const project = await client.project.create({
        data: { name: "Smoke Project", script: "Smoke test script" },
      });
      expect(project.id).toBeDefined();

      const fetchedBrand = await client.brand.findUnique({ where: { id: brand.id } });
      expect(fetchedBrand?.name).toBe("Smoke Brand");

      const fetchedProject = await client.project.findUnique({ where: { id: project.id } });
      expect(fetchedProject?.name).toBe("Smoke Project");
    } finally {
      await client.$disconnect();
    }
  });
});
