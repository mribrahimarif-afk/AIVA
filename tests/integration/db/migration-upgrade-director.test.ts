import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/infrastructure/db/client";

describe("Database Migration & Legacy Scene Preservation Tests", () => {
  beforeEach(async () => {
    await prisma.directorScene.deleteMany({});
    await prisma.directorPlan.deleteMany({});
    await prisma.scene.deleteMany({});
    await prisma.project.deleteMany({});
  });

  afterEach(async () => {
    await prisma.directorScene.deleteMany({});
    await prisma.directorPlan.deleteMany({});
    await prisma.scene.deleteMany({});
    await prisma.project.deleteMany({});
  });

  it("preserves legacy TASK-001/TASK-002 Scene rows without data loss or collision", async () => {
    const project = await prisma.project.create({
      data: {
        name: "Legacy Project",
        script: "Legacy script text.",
      },
    });

    // Create legacy Scene rows (TASK-001 format)
    const legacyScene1 = await prisma.scene.create({
      data: {
        projectId: project.id,
        sequence: 1,
        text: "Legacy scene 1 text",
        status: "READY",
      },
    });

    const legacyScene2 = await prisma.scene.create({
      data: {
        projectId: project.id,
        sequence: 2,
        text: "Legacy scene 2 text",
        status: "PENDING",
      },
    });

    // Create a DirectorPlan with DirectorScenes using sequence/order 1 and 2
    const directorPlan = await prisma.directorPlan.create({
      data: {
        projectId: project.id,
        originalScript: "New Director script with order 1 and 2.",
        scriptHash: "hash-12345",
        unitizerVersion: "1",
        schemaVersion: "1",
        promptVersion: "director-v1",
        model: "gemini-3.7-flash",
        language: "ENGLISH",
        contentType: "ADVERTISEMENT",
        summary: "Summary of director plan",
        creativeDirection: "Creative direction description",
        scenes: {
          create: [
            {
              order: 1,
              text: "Director scene 1 text",
              unitIds: JSON.stringify(["u0001"]),
              purpose: "HOOK",
              visualBrief: "Visual brief 1",
              visualSourceHint: "PRODUCT_LIBRARY",
              shotType: "PRODUCT_HERO",
              mood: "Energetic",
              setting: "Studio",
              subject: "Product",
              productPresence: "REQUIRED",
              searchQuery: "product hero",
              keywords: JSON.stringify(["hero", "product"]),
              sourceSpanStart: 0,
              sourceSpanEnd: 21,
            },
            {
              order: 2,
              text: "Director scene 2 text",
              unitIds: JSON.stringify(["u0002"]),
              purpose: "CTA",
              visualBrief: "Visual brief 2",
              visualSourceHint: "STOCK",
              shotType: "LIFESTYLE",
              mood: "Confident",
              setting: "Outdoor",
              subject: "Customer",
              productPresence: "PREFERRED",
              searchQuery: "happy customer",
              keywords: JSON.stringify(["happy", "customer"]),
              sourceSpanStart: 22,
              sourceSpanEnd: 45,
            },
          ],
        },
      },
    });

    // Verify both legacy scenes and director scenes coexist without collision
    const existingLegacyScenes = await prisma.scene.findMany({
      where: { projectId: project.id },
      orderBy: { sequence: "asc" },
    });
    expect(existingLegacyScenes).toHaveLength(2);
    expect(existingLegacyScenes[0]?.id).toBe(legacyScene1.id);
    expect(existingLegacyScenes[0]?.text).toBe("Legacy scene 1 text");
    expect(existingLegacyScenes[1]?.id).toBe(legacyScene2.id);
    expect(existingLegacyScenes[1]?.text).toBe("Legacy scene 2 text");

    const existingDirectorScenes = await prisma.directorScene.findMany({
      where: { directorPlanId: directorPlan.id },
      orderBy: { order: "asc" },
    });
    expect(existingDirectorScenes).toHaveLength(2);
    expect(existingDirectorScenes[0]?.text).toBe("Director scene 1 text");
    expect(existingDirectorScenes[1]?.text).toBe("Director scene 2 text");
  });
});
