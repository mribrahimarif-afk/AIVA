import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Isolated Database Migration Upgrade Verification (TASK-002 -> TASK-003)", () => {
  const tempDbFile = path.join(
    os.tmpdir(),
    `aiva-upgrade-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (fs.existsSync(tempDbFile)) {
      try {
        fs.unlinkSync(tempDbFile);
      } catch {}
    }

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:${tempDbFile}`,
        },
      },
    });

    // 1. Apply TASK-001 and TASK-002 migrations only
    const initSql = fs.readFileSync(
      path.resolve(process.cwd(), "prisma/migrations/20260826121100_init/migration.sql"),
      "utf8"
    );
    const vaultSql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "prisma/migrations/20260827020000_vault_brand_product_assets/migration.sql"
      ),
      "utf8"
    );

    for (const stmt of initSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
    for (const stmt of vaultSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }

    // 2. Insert representative TASK-002 records with full relationships
    const project = await prisma.project.create({
      data: {
        id: "proj-legacy-1",
        name: "Legacy Project",
        script: "Original script prior to TASK-003",
        aspectRatio: "16:9",
      },
    });

    await prisma.scene.create({
      data: {
        id: "scene-legacy-1",
        projectId: project.id,
        sequence: 1,
        text: "Legacy Scene 1 text",
        status: "READY",
      },
    });

    await prisma.scene.create({
      data: {
        id: "scene-legacy-2",
        projectId: project.id,
        sequence: 2,
        text: "Legacy Scene 2 text",
        status: "PENDING",
      },
    });

    const brand = await prisma.brand.create({
      data: {
        id: "brand-legacy-1",
        name: "Acme Corporation",
        slug: "acme-corp",
      },
    });

    const product = await prisma.product.create({
      data: {
        id: "prod-legacy-1",
        brandId: brand.id,
        name: "Acme Super Runner",
        slug: "acme-super-runner",
        description: "High performance running shoes",
      },
    });

    await prisma.productAlias.create({
      data: {
        id: "alias-legacy-1",
        productId: product.id,
        alias: "Super Runner",
        normalizedAlias: "super runner",
      },
    });

    const blob = await prisma.contentBlob.create({
      data: {
        id: "blob-legacy-1",
        checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        storagePath: "blobs/sha256/e3/b0/sample.png",
        sizeBytes: 2048,
        mimeType: "image/png",
      },
    });

    await prisma.asset.create({
      data: {
        id: "asset-legacy-1",
        blobId: blob.id,
        brandId: brand.id,
        productId: product.id,
        type: "IMAGE",
        vaultRole: "BRAND_LOGO",
        originalFilename: "acme_logo.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        source: "USER_UPLOAD",
        metadata: JSON.stringify({ verified: true }),
      },
    });

    // 3. Apply TASK-003 migration (20260827080000_director_scene_plan)
    const directorSql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "prisma/migrations/20260827080000_director_scene_plan/migration.sql"
      ),
      "utf8"
    );
    for (const stmt of directorSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
    if (fs.existsSync(tempDbFile)) {
      try {
        fs.unlinkSync(tempDbFile);
      } catch {}
    }
  });

  it("proves all pre-existing TASK-002 data is 100% preserved after applying TASK-003 migration", async () => {
    // 1. Verify Project
    const project = await prisma.project.findUnique({ where: { id: "proj-legacy-1" } });
    expect(project).not.toBeNull();
    expect(project!.name).toBe("Legacy Project");
    expect(project!.script).toBe("Original script prior to TASK-003");
    expect(project!.aspectRatio).toBe("16:9");

    // 2. Verify legacy Scene rows and sequence uniqueness
    const scenes = await prisma.scene.findMany({
      where: { projectId: "proj-legacy-1" },
      orderBy: { sequence: "asc" },
    });
    expect(scenes).toHaveLength(2);
    expect(scenes[0]?.id).toBe("scene-legacy-1");
    expect(scenes[0]?.sequence).toBe(1);
    expect(scenes[0]?.text).toBe("Legacy Scene 1 text");
    expect(scenes[1]?.id).toBe("scene-legacy-2");
    expect(scenes[1]?.sequence).toBe(2);

    // 3. Verify Brand & Product & Alias
    const brand = await prisma.brand.findUnique({
      where: { id: "brand-legacy-1" },
      include: { products: { include: { aliases: true } } },
    });
    expect(brand).not.toBeNull();
    expect(brand!.slug).toBe("acme-corp");
    expect(brand!.products).toHaveLength(1);
    expect(brand!.products[0]?.name).toBe("Acme Super Runner");
    expect(brand!.products[0]?.aliases).toHaveLength(1);
    expect(brand!.products[0]?.aliases[0]?.alias).toBe("Super Runner");

    // 4. Verify ContentBlob & Asset
    const asset = await prisma.asset.findUnique({
      where: { id: "asset-legacy-1" },
      include: { blob: true },
    });
    expect(asset).not.toBeNull();
    expect(asset!.vaultRole).toBe("BRAND_LOGO");
    expect(asset!.blob).not.toBeNull();
    expect(asset!.blob!.sizeBytes).toBe(2048);
  });

  it("proves DirectorPlan and DirectorScenes can be created and queried on upgraded database", async () => {
    const originalScript = "Upgraded script with order 1 and 2.";
    const plan = await prisma.directorPlan.create({
      data: {
        projectId: "proj-legacy-1",
        originalScript,
        scriptHash: "hash-upgraded-123",
        unitizerVersion: "1",
        schemaVersion: "1",
        promptVersion: "director-v1",
        model: "gemini-3.7-flash",
        language: "ENGLISH",
        contentType: "ADVERTISEMENT",
        summary: "Summary for upgraded plan",
        creativeDirection: "Creative direction description",
        brandId: "brand-legacy-1",
        productId: "prod-legacy-1",
        scenes: {
          create: [
            {
              order: 1, // Same sequence number 1 as legacy scene
              text: "Director scene 1 narration",
              unitIds: JSON.stringify(["u0001"]),
              purpose: "HOOK",
              visualBrief: "Visual brief for scene 1",
              visualSourceHint: "PRODUCT_LIBRARY",
              shotType: "PRODUCT_HERO",
              mood: "Energetic",
              setting: "Studio",
              subject: "Acme Runner",
              productPresence: "REQUIRED",
              searchQuery: "acme runner hero shot",
              keywords: JSON.stringify(["acme", "runner"]),
              manualAiPrompt: null,
              sourceSpanStart: 0,
              sourceSpanEnd: 20,
            },
            {
              order: 2, // Same sequence number 2 as legacy scene
              text: "Director scene 2 narration",
              unitIds: JSON.stringify(["u0002"]),
              purpose: "CTA",
              visualBrief: "Visual brief for scene 2",
              visualSourceHint: "STOCK",
              shotType: "LIFESTYLE",
              mood: "Inspiring",
              setting: "Track",
              subject: "Athlete",
              productPresence: "PREFERRED",
              searchQuery: "athlete running on track",
              keywords: JSON.stringify(["athlete", "running"]),
              manualAiPrompt: null,
              sourceSpanStart: 21,
              sourceSpanEnd: 35,
            },
          ],
        },
      },
      include: { scenes: { orderBy: { order: "asc" } } },
    });

    expect(plan.id).toBeDefined();
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[0]?.order).toBe(1);
    expect(plan.scenes[1]?.order).toBe(2);

    // Verify coexistence: legacy scene sequence 1 & 2 exist alongside director scene order 1 & 2
    const legacyScenes = await prisma.scene.findMany({ where: { projectId: "proj-legacy-1" } });
    expect(legacyScenes).toHaveLength(2);
    expect(legacyScenes.map((s) => s.sequence).sort()).toEqual([1, 2]);

    const directorScenes = await prisma.directorScene.findMany({
      where: { directorPlanId: plan.id },
    });
    expect(directorScenes).toHaveLength(2);
    expect(directorScenes.map((s) => s.order).sort()).toEqual([1, 2]);
  });

  it("enforces uniqueness constraint on [directorPlanId, order] preventing duplicate scene orders", async () => {
    const plan = await prisma.directorPlan.findUnique({
      where: { projectId: "proj-legacy-1" },
    });
    expect(plan).not.toBeNull();

    // Attempting to create duplicate scene order 1 under same plan must fail unique constraint
    await expect(
      prisma.directorScene.create({
        data: {
          directorPlanId: plan!.id,
          order: 1, // Duplicate of existing order 1
          text: "Duplicate order scene",
          unitIds: JSON.stringify(["u0001"]),
          purpose: "HOOK",
          visualBrief: "Visual brief duplicate",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Neutral",
          setting: "Room",
          subject: "Item",
          productPresence: "NOT_NEEDED",
          searchQuery: "query",
          keywords: JSON.stringify(["k"]),
          manualAiPrompt: null,
          sourceSpanStart: 0,
          sourceSpanEnd: 5,
        },
      })
    ).rejects.toThrow();
  });

  it("proves cascading delete of Project removes DirectorPlan and DirectorScenes", async () => {
    // Create an isolated project with plan and scene
    const cascadeProject = await prisma.project.create({
      data: {
        name: "Cascade Test Project",
        script: "Cascade script",
        directorPlan: {
          create: {
            originalScript: "Cascade script",
            scriptHash: "hash-cascade",
            unitizerVersion: "1",
            schemaVersion: "1",
            promptVersion: "director-v1",
            model: "gemini-3.7-flash",
            language: "ENGLISH",
            contentType: "ADVERTISEMENT",
            summary: "Cascade summary",
            creativeDirection: "Cascade direction",
            scenes: {
              create: [
                {
                  order: 1,
                  text: "Cascade script",
                  unitIds: JSON.stringify(["u0001"]),
                  purpose: "HOOK",
                  visualBrief: "Cascade brief",
                  visualSourceHint: "STOCK",
                  shotType: "LIFESTYLE",
                  mood: "Calm",
                  setting: "Nature",
                  subject: "Tree",
                  productPresence: "NOT_NEEDED",
                  searchQuery: "nature tree",
                  keywords: JSON.stringify(["nature"]),
                  manualAiPrompt: null,
                  sourceSpanStart: 0,
                  sourceSpanEnd: 14,
                },
              ],
            },
          },
        },
      },
      include: { directorPlan: { include: { scenes: true } } },
    });

    const planId = cascadeProject.directorPlan!.id;
    const sceneId = cascadeProject.directorPlan!.scenes[0]!.id;

    // Delete project
    await prisma.project.delete({ where: { id: cascadeProject.id } });

    // Verify DirectorPlan and DirectorScene are deleted via cascade
    const planAfterDelete = await prisma.directorPlan.findUnique({ where: { id: planId } });
    expect(planAfterDelete).toBeNull();

    const sceneAfterDelete = await prisma.directorScene.findUnique({ where: { id: sceneId } });
    expect(sceneAfterDelete).toBeNull();
  });
});
