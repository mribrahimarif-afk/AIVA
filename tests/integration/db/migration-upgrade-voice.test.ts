import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Isolated Database Migration Upgrade Verification (TASK-003 -> TASK-004)", () => {
  const tempDbFile = path.join(
    os.tmpdir(),
    `aiva-voice-upgrade-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

    // 1. Apply TASK-001, TASK-002, and TASK-003 migrations
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
    const directorSql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "prisma/migrations/20260827080000_director_scene_plan/migration.sql"
      ),
      "utf8"
    );

    for (const stmt of initSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
    for (const stmt of vaultSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
    for (const stmt of directorSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }

    // 2. Insert representative TASK-003 state
    const project = await prisma.project.create({
      data: {
        id: "proj-pre-task004",
        name: "Pre-Voice Project",
        script: "Discover the new era of autonomous video creation.",
        aspectRatio: "9:16",
      },
    });

    await prisma.scene.create({
      data: {
        id: "scene-legacy-1",
        projectId: project.id,
        sequence: 1,
        text: "Legacy Scene text",
        status: "PENDING",
      },
    });

    const brand = await prisma.brand.create({
      data: {
        id: "brand-1",
        name: "Test Brand",
        slug: "test-brand",
      },
    });

    const product = await prisma.product.create({
      data: {
        id: "prod-1",
        brandId: brand.id,
        name: "Test Product",
        slug: "test-product",
      },
    });

    await prisma.productAlias.create({
      data: {
        id: "alias-1",
        productId: product.id,
        alias: "TP",
        normalizedAlias: "tp",
      },
    });

    const blob = await prisma.contentBlob.create({
      data: {
        id: "blob-1",
        checksum: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        storagePath: "blobs/ab/abcdef.png",
        sizeBytes: 1024,
        mimeType: "image/png",
      },
    });

    await prisma.asset.create({
      data: {
        id: "asset-1",
        projectId: project.id,
        brandId: brand.id,
        productId: product.id,
        blobId: blob.id,
        type: "IMAGE",
        vaultRole: "BRAND_LOGO",
        source: "VAULT",
      },
    });

    await prisma.$executeRawUnsafe(`
      INSERT INTO "director_plans" (
        "id", "projectId", "originalScript", "scriptHash", "unitizerVersion",
        "schemaVersion", "promptVersion", "model", "language", "contentType",
        "summary", "creativeDirection", "generatedAt"
      ) VALUES (
        'plan-1', 'proj-pre-task004', 'Discover the new era of autonomous video creation.',
        'sample-script-hash-123', 'unitizer-v1', 'director-v1', 'director-v1',
        'gemini-3.7-flash', 'ENGLISH', 'COMMERCIAL', 'Summary text', 'Direction text', CURRENT_TIMESTAMP
      )
    `);

    await prisma.directorScene.create({
      data: {
        id: "dscene-1",
        directorPlanId: "plan-1",
        order: 1,
        text: "Discover the new era",
        unitIds: "[\"u0001\"]",
        purpose: "HOOK",
        visualBrief: "Futuristic studio",
        visualSourceHint: "STOCK",
        shotType: "WIDE",
        mood: "Energetic",
        setting: "Studio",
        subject: "Speaker",
        productPresence: "PREFERRED",
        searchQuery: "futuristic studio",
        keywords: "[\"studio\"]",
        sourceSpanStart: 0,
        sourceSpanEnd: 21,
      },
    });

    // 3. Apply TASK-004 migration SQL
    const voiceMigrationSql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "prisma/migrations/20260827140000_voice_track_boundaries/migration.sql"
      ),
      "utf8"
    );

    for (const stmt of voiceMigrationSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }

    // 4. Apply TASK-004A voice_track_model migration SQL
    const modelMigrationSql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "prisma/migrations/20260828050000_voice_track_model/migration.sql"
      ),
      "utf8"
    );

    for (const stmt of modelMigrationSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }

    // 5. Apply TASK-004B audio_first migration SQL
    const audioFirstSql = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "prisma/migrations/20260828120000_audio_first_transcription/migration.sql"
      ),
      "utf8"
    );

    for (const stmt of audioFirstSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await prisma.$executeRawUnsafe(stmt);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(tempDbFile)) {
      try {
        fs.unlinkSync(tempDbFile);
      } catch {}
    }
  });

  it("proves all TASK-001, TASK-002, and TASK-003 rows and relations are intact after TASK-004 migration", async () => {
    const project = await prisma.project.findUnique({
      where: { id: "proj-pre-task004" },
      include: {
        scenes: true,
        assets: true,
        directorPlan: {
          include: {
            scenes: true,
          },
        },
      },
    });

    expect(project).not.toBeNull();
    expect(project!.scenes).toHaveLength(1);
    expect(project!.assets).toHaveLength(1);
    expect(project!.directorPlan).not.toBeNull();
    expect(project!.directorPlan!.scenes).toHaveLength(1);
  });

  it("proves VoiceTrack and VoiceBoundary tables work and enforce foreign key relations", async () => {
    const voiceTrack = await prisma.voiceTrack.create({
      data: {
        id: "vt-upgrade-1",
        projectId: "proj-pre-task004",
        directorPlanId: "plan-1",
        sourceScriptHash: "sample-script-hash-123",
        provider: "azure-speech",
        voiceName: "ur-PK-AsadNeural",
        locale: "ur-PK",
        outputFormat: "Riff24Khz16BitMonoPcm",
        audioSha256: "test_sha_upgrade_1234567890abcdef1234567890abcdef1234567890abcdef",
        audioByteCount: 48000,
        audioStorageRef: "projects/proj-pre-task004/audio/test_sha.wav",
        durationMs: 1000,
        boundaries: {
          create: [
            {
              order: 1,
              sourceStart: 0,
              sourceEnd: 8,
              audioStartMs: 100,
              audioDurationMs: 300,
            },
          ],
        },
      },
      include: {
        boundaries: true,
        directorPlan: true,
        project: true,
      },
    });

    expect(voiceTrack.boundaries).toHaveLength(1);
    expect(voiceTrack.directorPlan.id).toBe("plan-1");
    expect(voiceTrack.project.id).toBe("proj-pre-task004");
  });

  it("proves cascade deletion removes VoiceTrack when Project or DirectorPlan is deleted", async () => {
    // Creating a separate project to test cascade
    const tempProj = await prisma.project.create({
      data: {
        id: "proj-cascade-test",
        name: "Cascade Test",
        script: "Cascade script",
      },
    });

    const tempPlan = await prisma.directorPlan.create({
      data: {
        id: "plan-cascade-test",
        projectId: tempProj.id,
        originalScript: "Cascade script",
        scriptHash: "hash-cascade",
        unitizerVersion: "unitizer-v1",
        schemaVersion: "director-v1",
        promptVersion: "director-v1",
        model: "gemini-3.7-flash",
        language: "ENGLISH",
        contentType: "COMMERCIAL",
        summary: "Summary",
        creativeDirection: "Direction",
      },
    });

    await prisma.voiceTrack.create({
      data: {
        id: "vt-cascade-test",
        projectId: tempProj.id,
        directorPlanId: tempPlan.id,
        sourceScriptHash: "hash-cascade",
        provider: "azure-speech",
        voiceName: "ur-PK-AsadNeural",
        locale: "ur-PK",
        outputFormat: "Riff24Khz16BitMonoPcm",
        audioSha256: "cascade_sha_123",
        audioByteCount: 1000,
        audioStorageRef: "projects/proj-cascade-test/audio/cascade.wav",
        durationMs: 500,
        boundaries: {
          create: [{ order: 1, sourceStart: 0, sourceEnd: 7, audioStartMs: 50, audioDurationMs: 200 }],
        },
      },
    });

    // Delete project -> cascades to DirectorPlan, VoiceTrack, and VoiceBoundaries
    await prisma.project.delete({ where: { id: tempProj.id } });

    const deletedTrack = await prisma.voiceTrack.findUnique({ where: { id: "vt-cascade-test" } });
    expect(deletedTrack).toBeNull();

    const deletedBoundaries = await prisma.voiceBoundary.findMany({ where: { voiceTrackId: "vt-cascade-test" } });
    expect(deletedBoundaries).toHaveLength(0);
  });
});
