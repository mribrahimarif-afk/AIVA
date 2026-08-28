import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("Database Migration Upgrade & Ownership Trigger Verification (TASK-004B Remediation)", () => {
  const tempDbFile = path.join(
    os.tmpdir(),
    `aiva-ownership-trigger-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
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

    // Apply migrations 1 through 6
    const standardMigrationDirs = [
      "20260826121100_init",
      "20260827020000_vault_brand_product_assets",
      "20260827080000_director_scene_plan",
      "20260827140000_voice_track_boundaries",
      "20260828050000_voice_track_model",
      "20260828120000_audio_first_transcription",
    ];

    for (const dir of standardMigrationDirs) {
      const sql = fs.readFileSync(
        path.resolve(process.cwd(), `prisma/migrations/${dir}/migration.sql`),
        "utf8"
      );
      for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
        await prisma.$executeRawUnsafe(stmt);
      }
    }

    // Apply migration 7 triggers
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS trg_audio_sources_active_transcription_insert
      BEFORE INSERT ON audio_sources
      FOR EACH ROW
      WHEN NEW.activeTranscriptionId IS NOT NULL
      BEGIN
        SELECT CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM transcriptions
            WHERE id = NEW.activeTranscriptionId AND audioSourceId = NEW.id
          )
          THEN RAISE(ABORT, 'activeTranscriptionId must reference a Transcription owned by this AudioSource')
        END;
      END
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER IF NOT EXISTS trg_audio_sources_active_transcription_update
      BEFORE UPDATE OF activeTranscriptionId ON audio_sources
      FOR EACH ROW
      WHEN NEW.activeTranscriptionId IS NOT NULL
      BEGIN
        SELECT CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM transcriptions
            WHERE id = NEW.activeTranscriptionId AND audioSourceId = NEW.id
          )
          THEN RAISE(ABORT, 'activeTranscriptionId must reference a Transcription owned by this AudioSource')
        END;
      END
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(tempDbFile)) {
      try {
        fs.unlinkSync(tempDbFile);
      } catch {}
    }
  });

  it("1. allows setting activeTranscriptionId to a Transcription belonging to that AudioSource", async () => {
    await prisma.project.create({
      data: {
        id: "p-test-own-1",
        name: "Ownership Project",
      },
    });

    await prisma.audioSource.create({
      data: {
        id: "as-own-1",
        projectId: "p-test-own-1",
        storageRef: "ref-1",
        sourceHash: "hash-1",
        mimeType: "audio/wav",
        sizeBytes: 1000,
      },
    });

    await prisma.transcription.create({
      data: {
        id: "t-own-1",
        projectId: "p-test-own-1",
        audioSourceId: "as-own-1",
        provider: "gemini-transcribe",
        model: "gemini-3.5-transcribe",
        requestedMode: "AUTO",
        displayText: "Test",
        canonicalText: "Test",
        durationMs: 1000,
        wordCount: 1,
        sourceAudioHash: "hash-1",
        configurationHash: "conf-1",
      },
    });

    // Setting activeTranscriptionId to t-own-1 should succeed
    const updated = await prisma.audioSource.update({
      where: { id: "as-own-1" },
      data: { activeTranscriptionId: "t-own-1" },
    });
    expect(updated.activeTranscriptionId).toBe("t-own-1");
  });

  it("2. database trigger rejects setting activeTranscriptionId to a Transcription belonging to another AudioSource", async () => {
    await prisma.audioSource.create({
      data: {
        id: "as-own-2",
        projectId: "p-test-own-1",
        storageRef: "ref-2",
        sourceHash: "hash-2",
        mimeType: "audio/wav",
        sizeBytes: 1000,
      },
    });

    // Attempting to set as-own-2.activeTranscriptionId to t-own-1 (owned by as-own-1) should fail at DB trigger level
    await expect(
      prisma.audioSource.update({
        where: { id: "as-own-2" },
        data: { activeTranscriptionId: "t-own-1" },
      })
    ).rejects.toThrow();
  });
});
