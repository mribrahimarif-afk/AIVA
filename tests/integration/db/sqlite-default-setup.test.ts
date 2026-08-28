import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { ensureSqliteParentDir } from "@/infrastructure/db/client";

describe("SQLite Default Local Setup & Parent Directory Auto-Creation Smoke Test", () => {
  const defaultUrlShape = "file:./test-default-smoke.db";
  const schemaDir = path.resolve(process.cwd(), "prisma");
  const expectedDbFile = path.resolve(schemaDir, "test-default-smoke.db");

  let originalDbUrl: string | undefined;

  beforeEach(() => {
    originalDbUrl = process.env.DATABASE_URL;
    if (fs.existsSync(expectedDbFile)) {
      fs.rmSync(expectedDbFile, { force: true });
    }
  });

  afterEach(() => {
    if (originalDbUrl !== undefined) {
      process.env.DATABASE_URL = originalDbUrl;
    }
    if (fs.existsSync(expectedDbFile)) {
      fs.rmSync(expectedDbFile, { force: true });
    }
  });

  it("proves production ensureSqliteParentDir prevents SQLite Error Code 14 on fresh clones using default DATABASE_URL relative shape", async () => {
    // 1. Target DB file is absent initially
    expect(fs.existsSync(expectedDbFile)).toBe(false);

    // 2. Set process.env.DATABASE_URL to default URL relative shape from .env.example
    process.env.DATABASE_URL = defaultUrlShape;

    // 3. Call the REAL production helper directly from client.ts
    const resolvedAbsPath = ensureSqliteParentDir(defaultUrlShape);
    expect(resolvedAbsPath).toBe(expectedDbFile);

    // 4. Verify parent directory (prisma/) exists on disk
    expect(fs.existsSync(schemaDir)).toBe(true);

    // 5. Apply real Prisma migrations to the database URL shape
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    execSync(`${npxCmd} prisma migrate deploy`, {
      env: { ...process.env, DATABASE_URL: defaultUrlShape },
      stdio: "pipe",
    });

    expect(fs.existsSync(expectedDbFile)).toBe(true);

    // 6. Connect PrismaClient and run Brand & Project queries
    const client = new PrismaClient({
      datasources: {
        db: { url: defaultUrlShape },
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
