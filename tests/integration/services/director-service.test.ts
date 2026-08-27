import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createBrandRepository } from "@/repositories/brand.repository";
import { createProductRepository } from "@/repositories/product.repository";
import { createDirectorPlanRepository } from "@/repositories/director-plan.repository";
import { createDirectorService } from "@/services/director.service";
import { FakeDirectorProvider } from "tests/mocks/fake-director.provider";
import { logger } from "@/infrastructure/logging/logger";
import { ValidationError, NotFoundError, ProviderError } from "@/domain/errors";

describe("DirectorService Integration & Atomicity Tests", () => {
  const projectRepo = createProjectRepository(prisma);
  const brandRepo = createBrandRepository(prisma);
  const productRepo = createProductRepository(prisma);
  const directorPlanRepo = createDirectorPlanRepository(prisma);

  let fakeAiProvider: FakeDirectorProvider;
  let service: ReturnType<typeof createDirectorService>;

  beforeEach(async () => {
    fakeAiProvider = new FakeDirectorProvider();
    service = createDirectorService({
      directorPlanRepository: directorPlanRepo,
      projectRepository: projectRepo,
      brandRepository: brandRepo,
      productRepository: productRepo,
      directorAiProvider: fakeAiProvider,
      logger,
    });

    await prisma.directorScene.deleteMany({});
    await prisma.directorPlan.deleteMany({});
    await prisma.scene.deleteMany({});
    await prisma.productAlias.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.brand.deleteMany({});
    await prisma.project.deleteMany({});
  });

  afterEach(async () => {
    await prisma.directorScene.deleteMany({});
    await prisma.directorPlan.deleteMany({});
    await prisma.scene.deleteMany({});
    await prisma.productAlias.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.brand.deleteMany({});
    await prisma.project.deleteMany({});
  });

  it("successfully analyzes script, validates invariants, and atomically persists DirectorPlan with scenes", async () => {
    const project = await projectRepo.create({
      name: "Commercial Alpha",
      script: "",
      aspectRatio: "9:16",
    });
    const brand = await brandRepo.create({
      name: "Nova Athletics",
      slug: "nova-athletics",
    });
    const product = await productRepo.create({
      brandId: brand.id,
      name: "Nova Runner Pro",
      slug: "nova-runner-pro",
      description: "Lightweight carbon fiber marathon running shoes",
    });
    await productRepo.addAlias({
      productId: product.id,
      alias: "Runner Pro",
      normalizedAlias: "runner pro",
    });
    await productRepo.addAlias({
      productId: product.id,
      alias: "Nova Pro",
      normalizedAlias: "nova pro",
    });

    const scriptText =
      "Built for the podium. Discover Nova Runner Pro with ultralight carbon fiber. Claim your personal best.";

    const plan = await service.analyzeAndPlan(project.id, {
      script: scriptText,
      brandId: brand.id,
      productId: product.id,
    });

    expect(plan).toBeDefined();
    expect(plan.projectId).toBe(project.id);
    expect(plan.originalScript).toBe(scriptText);
    expect(plan.unitizerVersion).toBe("1");
    expect(plan.schemaVersion).toBe("1");
    expect(plan.promptVersion).toBe("director-v1");
    expect(plan.brandId).toBe(brand.id);
    expect(plan.productId).toBe(product.id);
    expect(plan.scenes.length).toBeGreaterThanOrEqual(1);

    // Verify persisted DB records
    const retrieved = await service.getPlan(project.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.scenes).toHaveLength(plan.scenes.length);
    expect(retrieved!.scenes[0]?.text).toBe(plan.scenes[0]?.text);
  });

  it("rejects mismatched Product under wrong Brand", async () => {
    const project = await projectRepo.create({
      name: "Mismatch Test",
      script: "",
      aspectRatio: "9:16",
    });
    const brand1 = await brandRepo.create({ name: "Brand 1", slug: "brand-1" });
    const brand2 = await brandRepo.create({ name: "Brand 2", slug: "brand-2" });
    const product2 = await productRepo.create({
      brandId: brand2.id,
      name: "Product Under Brand 2",
      slug: "product-2",
    });

    await expect(
      service.analyzeAndPlan(project.id, {
        script: "Testing mismatch validation.",
        brandId: brand1.id,
        productId: product2.id, // Belongs to brand2
      })
    ).rejects.toThrow(ValidationError);
  });

  it("handles single bounded repair when initial generation fails local validation and persists repaired metadata", async () => {
    const project = await projectRepo.create({
      name: "Repair Test",
      script: "",
      aspectRatio: "9:16",
    });

    // Custom initial output that fails validation (missing u0002) with distinct metadata
    fakeAiProvider.customAnalyze = async (input) => ({
      language: "ENGLISH",
      contentType: "ADVERTISEMENT",
      summary: "INITIAL INVALID SUMMARY",
      creativeDirection: "INITIAL INVALID CREATIVE DIRECTION",
      scenes: [
        {
          order: 1,
          unitIds: [input.scriptUnits[0]?.id || "u0001"], // Omits u0002 -> triggers repair
          purpose: "HOOK",
          visualBrief: "Initial brief with missing unit 2",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Energetic",
          setting: "Urban",
          subject: "Person",
          productPresence: "PREFERRED",
          searchQuery: "urban runner",
          keywords: ["urban"],
          manualAiPrompt: null,
        },
      ],
    });

    // Custom repair output with all units and deliberately different metadata
    fakeAiProvider.customRepair = async (input) => ({
      language: "URDU",
      contentType: "PRODUCT_SHOWCASE",
      summary: "REPAIRED VALID SUMMARY",
      creativeDirection: "REPAIRED VALID CREATIVE DIRECTION",
      scenes: [
        {
          order: 1,
          unitIds: [input.scriptUnits[0]?.id || "u0001"],
          purpose: "HOOK",
          visualBrief: "Repaired visual brief for scene 1",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Energetic",
          setting: "Urban",
          subject: "Person",
          productPresence: "PREFERRED",
          searchQuery: "urban runner",
          keywords: ["urban"],
          manualAiPrompt: null,
        },
        {
          order: 2,
          unitIds: [input.scriptUnits[1]?.id || "u0002"],
          purpose: "CTA",
          visualBrief: "Repaired visual brief for scene 2",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Confident",
          setting: "Studio",
          subject: "Customer",
          productPresence: "PREFERRED",
          searchQuery: "happy customer",
          keywords: ["customer"],
          manualAiPrompt: null,
        },
      ],
    });

    const scriptText = "Sentence one is here. Sentence two is following.";

    const plan = await service.analyzeAndPlan(project.id, {
      script: scriptText,
    });

    expect(fakeAiProvider.analyzeCallCount).toBe(1);
    expect(fakeAiProvider.repairCallCount).toBe(1);

    // Verify persisted and returned metadata matches REPAIRED output, not initial invalid output
    expect(plan.language).toBe("URDU");
    expect(plan.contentType).toBe("PRODUCT_SHOWCASE");
    expect(plan.summary).toBe("REPAIRED VALID SUMMARY");
    expect(plan.creativeDirection).toBe("REPAIRED VALID CREATIVE DIRECTION");
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[0]?.visualBrief).toBe("Repaired visual brief for scene 1");
    expect(plan.scenes[1]?.visualBrief).toBe("Repaired visual brief for scene 2");

    // Verify DB record matches
    const persisted = await service.getPlan(project.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.language).toBe("URDU");
    expect(persisted!.contentType).toBe("PRODUCT_SHOWCASE");
    expect(persisted!.summary).toBe("REPAIRED VALID SUMMARY");
    expect(persisted!.creativeDirection).toBe("REPAIRED VALID CREATIVE DIRECTION");
  });

  it("proves a failed repair throws ProviderError and never replaces previously persisted DirectorPlan", async () => {
    const project = await projectRepo.create({
      name: "Failed Repair Test",
      script: "",
      aspectRatio: "9:16",
    });

    // 1. Establish initial good plan
    const initialPlan = await service.analyzeAndPlan(project.id, {
      script: "Initial stable script. Second sentence.",
    });
    expect(initialPlan.summary).not.toBe("STILL BROKEN");

    // 2. Set up provider so analyze fails AND repair fails
    fakeAiProvider.customAnalyze = async (input) => ({
      language: "ENGLISH",
      contentType: "ADVERTISEMENT",
      summary: "INVALID INITIAL",
      creativeDirection: "INVALID INITIAL",
      scenes: [
        {
          order: 1,
          unitIds: [input.scriptUnits[0]?.id || "u0001"], // Omits unit 2
          purpose: "HOOK",
          visualBrief: "Invalid brief 1",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Energetic",
          setting: "Urban",
          subject: "Person",
          productPresence: "PREFERRED",
          searchQuery: "urban runner",
          keywords: ["urban"],
          manualAiPrompt: null,
        },
      ],
    });

    fakeAiProvider.customRepair = async (input) => ({
      language: "ENGLISH",
      contentType: "ADVERTISEMENT",
      summary: "STILL BROKEN",
      creativeDirection: "STILL BROKEN",
      scenes: [
        {
          order: 1,
          unitIds: [input.scriptUnits[0]?.id || "u0001"], // Still omits unit 2
          purpose: "HOOK",
          visualBrief: "Still broken brief",
          visualSourceHint: "STOCK",
          shotType: "LIFESTYLE",
          mood: "Energetic",
          setting: "Urban",
          subject: "Person",
          productPresence: "PREFERRED",
          searchQuery: "urban runner",
          keywords: ["urban"],
          manualAiPrompt: null,
        },
      ],
    });

    await expect(
      service.analyzeAndPlan(project.id, {
        script: "New attempt script. That fails repair.",
      })
    ).rejects.toThrow(ProviderError);

    // Exactly 1 repair call occurred (no second repair loop)
    expect(fakeAiProvider.repairCallCount).toBe(1);

    // Verify the previously persisted plan is still 100% intact
    const planAfterFailedRepair = await service.getPlan(project.id);
    expect(planAfterFailedRepair).not.toBeNull();
    expect(planAfterFailedRepair!.id).toBe(initialPlan.id);
    expect(planAfterFailedRepair!.originalScript).toBe("Initial stable script. Second sentence.");
  });

  it("re-analysis atomically replaces existing scenes and updates generatedAt", async () => {
    const project = await projectRepo.create({
      name: "Re-analysis Test",
      script: "",
      aspectRatio: "9:16",
    });
    const script1 = "First initial script version with unique content.";

    const initialPlan = await service.analyzeAndPlan(project.id, {
      script: script1,
    });

    const initialGeneratedAt = initialPlan.generatedAt.getTime();
    const initialSceneIds = initialPlan.scenes.map((s) => s.id);

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 50));

    const script2 = "Second updated script version replacing the previous scenes completely.";
    const updatedPlan = await service.analyzeAndPlan(project.id, {
      script: script2,
    });

    expect(updatedPlan.originalScript).toBe(script2);
    expect(updatedPlan.generatedAt.getTime()).toBeGreaterThanOrEqual(initialGeneratedAt);

    // Verify previous scenes were replaced
    const currentScenes = await prisma.directorScene.findMany({
      where: { directorPlanId: updatedPlan.id },
    });

    for (const oldId of initialSceneIds) {
      if (oldId) {
        expect(currentScenes.some((s) => s.id === oldId)).toBe(false);
      }
    }
  });

  it("fails safely and leaves prior plan untouched if AI analysis fails", async () => {
    const project = await projectRepo.create({
      name: "Failure Safety Test",
      script: "",
      aspectRatio: "9:16",
    });
    const validScript = "Original good script.";

    const initialPlan = await service.analyzeAndPlan(project.id, {
      script: validScript,
    });

    // Make provider fail
    fakeAiProvider.errorToThrow = new ProviderError(fakeAiProvider.id, "Simulated network timeout");

    await expect(
      service.analyzeAndPlan(project.id, {
        script: "Attempted broken script update.",
      })
    ).rejects.toThrow(ProviderError);

    // Verify existing plan is still intact
    const planAfterFailure = await service.getPlan(project.id);
    expect(planAfterFailure).not.toBeNull();
    expect(planAfterFailure!.originalScript).toBe(validScript);
  });

  it("proves complete aggregate rollback when an error occurs mid-transaction during production replacePlan", async () => {
    const oldScript = "Old original script that must survive rollback.";
    const project = await projectRepo.create({
      name: "Atomicity Rollback Test",
      script: oldScript,
      aspectRatio: "16:9",
    });

    // 1. Establish initial valid DirectorPlan and scenes
    const initialPlan = await service.analyzeAndPlan(project.id, {
      script: oldScript,
    });
    expect(initialPlan.originalScript).toBe(oldScript);
    const initialScenes = await prisma.directorScene.findMany({
      where: { directorPlanId: initialPlan.id },
      orderBy: { order: "asc" },
    });
    expect(initialScenes.length).toBeGreaterThan(0);
    const initialSceneIds = initialScenes.map((s) => s.id);
    const initialGeneratedAt = initialPlan.generatedAt;

    const newScript = "New candidate script that should be rolled back completely.";

    // 2. Call the REAL production directorPlanRepo.replacePlan with duplicate scene orders
    // to trigger a natural SQLite UNIQUE(directorPlanId, order) constraint failure on createMany
    // AFTER tx.project.update and tx.directorPlan.upsert have already executed inside the transaction.
    const duplicateOrderScenes: Parameters<typeof directorPlanRepo.replacePlan>[2] = [
      {
        order: 1,
        text: "Scene 1 narration",
        unitIds: ["u0001"],
        purpose: "HOOK",
        visualBrief: "Scene 1 brief",
        visualSourceHint: "STOCK",
        shotType: "PRODUCT_HERO",
        mood: "Dramatic",
        setting: "Studio",
        subject: "Product",
        productPresence: "PREFERRED",
        searchQuery: "product hero",
        keywords: ["product"],
        manualAiPrompt: null,
        sourceSpanStart: 0,
        sourceSpanEnd: 10,
      },
      {
        order: 1, // Duplicate order causes natural UNIQUE(directorPlanId, order) collision in DB
        text: "Scene 2 duplicate order narration",
        unitIds: ["u0002"],
        purpose: "PROBLEM",
        visualBrief: "Scene 2 brief",
        visualSourceHint: "STOCK",
        shotType: "PRODUCT_DETAIL",
        mood: "Dramatic",
        setting: "Studio",
        subject: "Product",
        productPresence: "PREFERRED",
        searchQuery: "product closeup",
        keywords: ["product"],
        manualAiPrompt: null,
        sourceSpanStart: 11,
        sourceSpanEnd: 20,
      },
    ];

    // 3. Attempt replacePlan with duplicate order scenes
    await expect(
      directorPlanRepo.replacePlan(
        project.id,
        {
          projectId: project.id,
          originalScript: newScript,
          scriptHash: "new-hash-12345",
          unitizerVersion: "1.0.0",
          schemaVersion: "1.0.0",
          promptVersion: "1.0.0",
          model: "gemini-3.7-flash",
          language: "ENGLISH",
          contentType: "ADVERTISEMENT",
          summary: "New summary that should be rolled back",
          creativeDirection: "New direction that should be rolled back",
        },
        duplicateOrderScenes
      )
    ).rejects.toThrow();

    // 4. Reload all database state and assert 100% rollback of the aggregate
    const reloadedProject = await projectRepo.findById(project.id);
    expect(reloadedProject).not.toBeNull();
    expect(reloadedProject!.script).toBe(oldScript);

    const reloadedPlan = await prisma.directorPlan.findUnique({
      where: { projectId: project.id },
    });
    expect(reloadedPlan).not.toBeNull();
    expect(reloadedPlan!.id).toBe(initialPlan.id);
    expect(reloadedPlan!.originalScript).toBe(oldScript);
    expect(reloadedPlan!.scriptHash).toBe(initialPlan.scriptHash);
    expect(reloadedPlan!.summary).toBe(initialPlan.summary);
    expect(reloadedPlan!.creativeDirection).toBe(initialPlan.creativeDirection);
    expect(reloadedPlan!.generatedAt.getTime()).toBe(initialGeneratedAt.getTime());

    const reloadedScenes = await prisma.directorScene.findMany({
      where: { directorPlanId: initialPlan.id },
      orderBy: { order: "asc" },
    });
    expect(reloadedScenes).toHaveLength(initialScenes.length);
    expect(reloadedScenes.map((s) => s.id)).toEqual(initialSceneIds);
    expect(reloadedScenes[0]?.text).toBe(initialScenes[0]?.text);
  });

  it("proves successful re-analysis atomically updates Project.script, DirectorPlan, and DirectorScenes together", async () => {
    const initialScript = "Initial script before update.";
    const project = await projectRepo.create({
      name: "Atomic Success Test",
      script: initialScript,
      aspectRatio: "9:16",
    });

    const initialPlan = await service.analyzeAndPlan(project.id, {
      script: initialScript,
    });
    expect(initialPlan.originalScript).toBe(initialScript);

    const projectBeforeUpdate = await projectRepo.findById(project.id);
    expect(projectBeforeUpdate!.script).toBe(initialScript);

    const updatedScript = "Updated script successfully replacing everything in one atomic transaction.";
    const updatedPlan = await service.analyzeAndPlan(project.id, {
      script: updatedScript,
    });

    // Verify Project.script was updated to exact new string
    const projectAfterUpdate = await projectRepo.findById(project.id);
    expect(projectAfterUpdate!.script).toBe(updatedScript);

    // Verify DirectorPlan was updated
    expect(updatedPlan.originalScript).toBe(updatedScript);
    expect(updatedPlan.scriptHash).toBe(
      createHash("sha256").update(updatedScript, "utf8").digest("hex")
    );

    // Verify DirectorScenes match the updated plan
    const persistedScenes = await prisma.directorScene.findMany({
      where: { directorPlanId: updatedPlan.id },
      orderBy: { order: "asc" },
    });
    expect(persistedScenes).toHaveLength(updatedPlan.scenes.length);
  });

  it("persists and reports the actual fallback model when provider executes failover", async () => {
    const script = "Simple script testing fallback model persistence.";
    const project = await projectRepo.create({
      name: "Fallback Model Test",
      script,
      aspectRatio: "9:16",
    });

    // Configure fake provider to return fallback model
    fakeAiProvider.customAnalyze = async (input) => {
      const defaultPlan = fakeAiProvider.generateDefaultValidPlan(input);
      return {
        ...defaultPlan,
        model: "gemini-2.5-flash",
      };
    };

    const plan = await service.analyzeAndPlan(project.id, { script });
    expect(plan.model).toBe("gemini-2.5-flash");

    // Verify DB persisted record
    const retrieved = await service.getPlan(project.id);
    expect(retrieved?.model).toBe("gemini-2.5-flash");
  });
});
