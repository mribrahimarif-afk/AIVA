import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

describe("Database Migration Upgrade Verification (TASK-001 -> TASK-002)", () => {
  const testDbDir = path.resolve(process.cwd(), ".test-migration");
  const dbPath = path.join(testDbDir, "upgrade-test.db");
  let db: PrismaClient;

  beforeEach(async () => {
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { force: true });
    }
    fs.mkdirSync(testDbDir, { recursive: true });
    db = new PrismaClient({
      datasources: {
        db: {
          url: `file:${dbPath}`,
        },
      },
    });
  });

  afterEach(async () => {
    if (db) {
      await db.$disconnect();
    }
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { force: true });
    }
  });

  it("preserves TASK-001 records and seamlessly upgrades schema to TASK-002", async () => {
    // 1. Read and apply TASK-001 migration SQL
    const initSqlPath = path.resolve(process.cwd(), "prisma/migrations/20260826121100_init/migration.sql");
    const initSql = fs.readFileSync(initSqlPath, "utf-8");

    const initStatements = initSql.split(";").filter((s) => s.trim().length > 0);
    for (const statement of initStatements) {
      await db.$executeRawUnsafe(statement);
    }

    // 2. Insert representative TASK-001 data using raw SQL (matching TASK-001 table schema)
    await db.$executeRawUnsafe(
      `INSERT INTO "projects" ("id", "name", "script", "status", "aspectRatio", "createdAt", "updatedAt") VALUES ('proj_v1', 'V1 Existing Project', 'Initial script text', 'DRAFT', '9:16', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    );

    await db.$executeRawUnsafe(
      `INSERT INTO "scenes" ("id", "projectId", "sequence", "text", "status", "createdAt", "updatedAt") VALUES ('scene_v1', 'proj_v1', 0, 'Scene 1 Text', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    );

    await db.$executeRawUnsafe(
      `INSERT INTO "assets" ("id", "type", "source", "projectId", "createdAt") VALUES ('asset_v1', 'SOURCE', 'LOCAL_UPLOAD', 'proj_v1', CURRENT_TIMESTAMP)`
    );

    // 3. Read and apply TASK-002 migration SQL
    const vaultSqlPath = path.resolve(
      process.cwd(),
      "prisma/migrations/20260827020000_vault_brand_product_assets/migration.sql"
    );
    const vaultSql = fs.readFileSync(vaultSqlPath, "utf-8");

    const vaultStatements = vaultSql.split(";").filter((s) => s.trim().length > 0);
    for (const statement of vaultStatements) {
      await db.$executeRawUnsafe(statement);
    }

    // 4. Verify existing TASK-001 data preserved & readable via Prisma ORM
    const fetchedProject = await db.project.findUnique({ where: { id: "proj_v1" } });
    expect(fetchedProject).not.toBeNull();
    expect(fetchedProject?.name).toBe("V1 Existing Project");

    const fetchedScene = await db.scene.findUnique({ where: { id: "scene_v1" } });
    expect(fetchedScene).not.toBeNull();
    expect(fetchedScene?.text).toBe("Scene 1 Text");

    const fetchedAsset = await db.asset.findUnique({ where: { id: "asset_v1" } });
    expect(fetchedAsset).not.toBeNull();
    expect(fetchedAsset?.projectId).toBe("proj_v1");

    // 5. Verify TASK-002 new tables and added columns are functional
    const brand = await db.brand.create({
      data: { name: "Upgraded Brand", slug: "upgraded-brand" },
    });
    expect(brand.id).toBeDefined();

    const product = await db.product.create({
      data: { brandId: brand.id, name: "Upgraded Product", slug: "upgraded-product" },
    });
    expect(product.id).toBeDefined();

    const blob = await db.contentBlob.create({
      data: {
        checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        storagePath: "assets/blobs/e3/e3b0c44.mp4",
        sizeBytes: 1024,
        mimeType: "video/mp4",
      },
    });
    expect(blob.id).toBeDefined();

    const vaultAsset = await db.asset.create({
      data: {
        title: "Upgraded Vault Asset",
        type: "PRODUCT",
        vaultRole: "PRODUCT_VIDEO",
        source: "LOCAL_UPLOAD",
        brandId: brand.id,
        productId: product.id,
        blobId: blob.id,
        checksum: blob.checksum,
      },
    });
    expect(vaultAsset.id).toBeDefined();
  });
});
