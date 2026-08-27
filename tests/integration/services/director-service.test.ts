import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

  it("handles single bounded repair when initial generation fails local validation", async () => {
    const project = await projectRepo.create({
      name: "Repair Test",
      script: "",
      aspectRatio: "9:16",
    });
    fakeAiProvider.failFirstAttemptWithInvalid = true; // Triggers initial validation failure

    const scriptText = "Sentence one is here. Sentence two is following.";

    const plan = await service.analyzeAndPlan(project.id, {
      script: scriptText,
    });

    expect(fakeAiProvider.analyzeCallCount).toBe(1);
    expect(fakeAiProvider.repairCallCount).toBe(1);
    expect(plan).toBeDefined();
    expect(plan.scenes.length).toBeGreaterThanOrEqual(1);
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
});
