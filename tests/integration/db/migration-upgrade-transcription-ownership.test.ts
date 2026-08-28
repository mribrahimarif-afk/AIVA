import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let blockDepth = 0;

  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--") || trimmed.length === 0) continue;

    current += line + "\n";

    const upper = trimmed.toUpperCase();
    if (upper.includes("BEGIN") || /\bCASE\b/.test(upper)) {
      blockDepth++;
    }
    if (upper.startsWith("END") || upper.endsWith("END;") || /\bEND\b;?$/.test(upper)) {
      if (blockDepth > 0) {
        blockDepth--;
      }
    }

    if (blockDepth === 0 && trimmed.endsWith(";")) {
      statements.push(current.trim());
      current = "";
    }
  }

  if (current.trim().length > 0) {
    statements.push(current.trim());
  }

  return statements.filter((s) => s.length > 0 && s !== ";");
}

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

    // Apply all standard migrations 1 through 9 sequentially
    const standardMigrationDirs = [
      "20260826121100_init",
      "20260827020000_vault_brand_product_assets",
      "20260827080000_director_scene_plan",
      "20260827140000_voice_track_boundaries",
      "20260828050000_voice_track_model",
      "20260828120000_audio_first_transcription",
      "20260828160000_transcription_ownership_constraints",
      "20260828180000_director_plan_provenance_hardening",
      "20260828200000_director_audio_hash_required",
    ];

    for (const dir of standardMigrationDirs) {
      const sql = fs.readFileSync(
        path.resolve(process.cwd(), `prisma/migrations/${dir}/migration.sql`),
        "utf8"
      );
      const stmts = splitSqlStatements(sql);
      for (const stmt of stmts) {
        await prisma.$executeRawUnsafe(stmt);
      }
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

  it("3. database trigger rejects DirectorPlan with sourceTranscriptionId from a different project", async () => {
    await prisma.project.create({
      data: {
        id: "p-test-foreign",
        name: "Foreign Project",
      },
    });

    // Attempting to insert an AUDIO_TRANSCRIPT DirectorPlan for p-test-foreign referencing t-own-1 (which belongs to p-test-own-1)
    await expect(
      prisma.directorPlan.create({
        data: {
          id: "dp-foreign-fail",
          projectId: "p-test-foreign",
          originalScript: "Test script",
          scriptHash: "hash-script",
          unitizerVersion: "v1",
          schemaVersion: "v1",
          promptVersion: "v1",
          model: "gemini-model",
          language: "en",
          contentType: "PROMOTIONAL",
          summary: "Summary",
          creativeDirection: "Direction",
          sourceType: "AUDIO_TRANSCRIPT",
          sourceTranscriptionId: "t-own-1", // foreign project!
          sourceAudioHash: "hash-1",
        },
      })
    ).rejects.toThrow();
  });

  it("4. database trigger rejects AUDIO_TRANSCRIPT DirectorPlan with NULL sourceAudioHash", async () => {
    await expect(
      prisma.directorPlan.create({
        data: {
          id: "dp-null-hash-fail",
          projectId: "p-test-own-1",
          originalScript: "Test script",
          scriptHash: "hash-script-null-test",
          unitizerVersion: "v1",
          schemaVersion: "v1",
          promptVersion: "v1",
          model: "gemini-model",
          language: "en",
          contentType: "PROMOTIONAL",
          summary: "Summary",
          creativeDirection: "Direction",
          sourceType: "AUDIO_TRANSCRIPT",
          sourceTranscriptionId: "t-own-1",
          sourceAudioHash: null, // NULL must be rejected!
        },
      })
    ).rejects.toThrow();
  });

  it("5. database trigger rejects AUDIO_TRANSCRIPT DirectorPlan with mismatched sourceAudioHash", async () => {
    await expect(
      prisma.directorPlan.create({
        data: {
          id: "dp-mismatched-hash-fail",
          projectId: "p-test-own-1",
          originalScript: "Test script",
          scriptHash: "hash-script-mismatch",
          unitizerVersion: "v1",
          schemaVersion: "v1",
          promptVersion: "v1",
          model: "gemini-model",
          language: "en",
          contentType: "PROMOTIONAL",
          summary: "Summary",
          creativeDirection: "Direction",
          sourceType: "AUDIO_TRANSCRIPT",
          sourceTranscriptionId: "t-own-1",
          sourceAudioHash: "different-hash-value", // Mismatched hash!
        },
      })
    ).rejects.toThrow();
  });

  it("6. database trigger allows AUDIO_TRANSCRIPT DirectorPlan when sourceTranscriptionId and sourceAudioHash match exactly", async () => {
    const plan = await prisma.directorPlan.create({
      data: {
        id: "dp-valid-prov",
        projectId: "p-test-own-1",
        originalScript: "Test script",
        scriptHash: "hash-script-valid",
        unitizerVersion: "v1",
        schemaVersion: "v1",
        promptVersion: "v1",
        model: "gemini-model",
        language: "en",
        contentType: "PROMOTIONAL",
        summary: "Summary",
        creativeDirection: "Direction",
        sourceType: "AUDIO_TRANSCRIPT",
        sourceTranscriptionId: "t-own-1",
        sourceAudioHash: "hash-1", // Matches t-own-1.sourceAudioHash!
      },
    });

    expect(plan.id).toBe("dp-valid-prov");
    expect(plan.sourceTranscriptionId).toBe("t-own-1");
    expect(plan.sourceAudioHash).toBe("hash-1");
  });

  it("7. database trigger allows SCRIPT DirectorPlan without requiring Audio-First fields", async () => {
    await prisma.project.create({
      data: {
        id: "p-test-script-1",
        name: "Script Project",
      },
    });

    const plan = await prisma.directorPlan.create({
      data: {
        id: "dp-script-first-valid",
        projectId: "p-test-script-1",
        originalScript: "Script First text",
        scriptHash: "hash-script-sf",
        unitizerVersion: "v1",
        schemaVersion: "v1",
        promptVersion: "v1",
        model: "gemini-model",
        language: "en",
        contentType: "PROMOTIONAL",
        summary: "Summary",
        creativeDirection: "Direction",
        sourceType: "SCRIPT",
        sourceTranscriptionId: null,
        sourceAudioHash: null,
      },
    });

    expect(plan.id).toBe("dp-script-first-valid");
    expect(plan.sourceType).toBe("SCRIPT");
    expect(plan.sourceTranscriptionId).toBeNull();
  });
});
