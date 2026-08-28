import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Isolated Database Migration Upgrade Verification (TASK-004A -> TASK-004B)", () => {
  const tempDbFile = path.join(
    os.tmpdir(),
    `aiva-audio-first-upgrade-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

    // 1. Apply TASK-001, TASK-002, TASK-003, and TASK-004 migrations
    const migrationDirs = [
      "20260826121100_init",
      "20260827020000_vault_brand_product_assets",
      "20260827080000_director_scene_plan",
      "20260827140000_voice_track_boundaries",
      "20260828050000_voice_track_model",
    ];

    for (const dir of migrationDirs) {
      const sql = fs.readFileSync(
        path.resolve(process.cwd(), `prisma/migrations/${dir}/migration.sql`),
        "utf8"
      );
      for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
        await prisma.$executeRawUnsafe(stmt);
      }
    }

    // 2. Insert representative TASK-004A state before migration
    const project = await prisma.project.create({
      data: {
        id: "proj-legacy-1",
        name: "Legacy Project",
        aspectRatio: "9:16",
        script: "Initial script before audio first",
      },
    });

    await prisma.$executeRawUnsafe(`
      INSERT INTO "director_plans" (
        "id", "projectId", "originalScript", "scriptHash", "unitizerVersion",
        "schemaVersion", "promptVersion", "model", "language", "contentType",
        "summary", "creativeDirection", "generatedAt"
      ) VALUES (
        'plan-legacy-1', 'proj-legacy-1', 'Initial script before audio first', 'hash_legacy_123',
        '1.0.0', '1', 'director-v1', 'gemini-3.7-flash', 'ENGLISH', 'ADVERTISEMENT',
        'Legacy summary', 'Legacy creative direction', CURRENT_TIMESTAMP
      )
    `);

    // 3. Apply TASK-004B migration
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

  it("preserves existing DirectorPlan with default sourceType='SCRIPT' and null provenance references", async () => {
    const plans = await prisma.directorPlan.findMany();
    expect(plans).toHaveLength(1);
    expect((plans[0] as any).sourceType).toBe("SCRIPT");
    expect((plans[0] as any).sourceTranscriptionId).toBeNull();
    expect((plans[0] as any).sourceAudioHash).toBeNull();
  });

  it("supports creating and querying AudioSource, Transcription, and TranscriptionWord models", async () => {
    const project = await prisma.project.findFirstOrThrow();

    const audioSource = await prisma.audioSource.create({
      data: {
        projectId: project.id,
        storageRef: `projects/${project.id}/source/test.wav`,
        sourceHash: "abc123audiohash",
        mimeType: "audio/wav",
        sizeBytes: 123456,
        durationMs: 4500,
        originalDisplayName: "voiceover.wav",
      },
    });

    const transcription = await prisma.transcription.create({
      data: {
        projectId: project.id,
        audioSourceId: audioSource.id,
        provider: "gemini-transcribe",
        model: "gemini-3.5-transcribe",
        requestedMode: "AUTO",
        displayText: "Hello world",
        canonicalText: "Hello world",
        durationMs: 4500,
        wordCount: 2,
        sourceAudioHash: "abc123audiohash",
        configurationHash: "conf_hash_123",
      },
    });

    await prisma.transcriptionWord.createMany({
      data: [
        {
          transcriptionId: transcription.id,
          sequence: 1,
          text: "Hello",
          startMs: 0,
          endMs: 500,
          sourceStart: 0,
          sourceEnd: 5,
        },
        {
          transcriptionId: transcription.id,
          sequence: 2,
          text: "world",
          startMs: 550,
          endMs: 1200,
          sourceStart: 6,
          sourceEnd: 11,
        },
      ],
    });

    const retrieved = await prisma.transcription.findUniqueOrThrow({
      where: { id: transcription.id },
      include: {
        words: { orderBy: { sequence: "asc" } },
        audioSource: true,
      },
    });

    expect(retrieved.words).toHaveLength(2);
    expect(retrieved.words[0]!.text).toBe("Hello");
    expect(retrieved.words[1]!.text).toBe("world");
    expect(retrieved.audioSource.originalDisplayName).toBe("voiceover.wav");
  });
});
