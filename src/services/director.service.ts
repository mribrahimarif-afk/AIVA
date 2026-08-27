import { createHash } from "crypto";
import { NotFoundError, ValidationError, ProviderError } from "@/domain/errors";
import {
  UNITIZER_VERSION,
  DIRECTOR_SCHEMA_VERSION,
  DIRECTOR_PROMPT_VERSION,
  unitizeScript,
  validateAndReconstructPlan,
} from "@/domain/director";
import type {
  DirectorPlan,
  DirectorScene,
  AnalyzeScriptInput,
} from "@/domain/director";
import type {
  DirectorPlanRepository,
  ProjectRepository,
  BrandRepository,
  ProductRepository,
} from "@/repositories";
import type {
  DirectorAiProvider,
  BrandContextForDirector,
  ProductContextForDirector,
} from "@/providers/ai";
import { Logger } from "@/infrastructure/logging/logger";

export interface DirectorServiceOptions {
  directorPlanRepository: DirectorPlanRepository;
  projectRepository: ProjectRepository;
  brandRepository: BrandRepository;
  productRepository: ProductRepository;
  directorAiProvider: DirectorAiProvider;
  logger: Logger;
  maxScriptChars?: number;
}

export interface DirectorService {
  getPlan(projectId: string): Promise<DirectorPlan | null>;
  analyzeAndPlan(projectId: string, input: AnalyzeScriptInput): Promise<DirectorPlan>;
  isAiConfigured(): boolean;
}

export function createDirectorService(options: DirectorServiceOptions): DirectorService {
  const {
    directorPlanRepository,
    projectRepository,
    brandRepository,
    productRepository,
    directorAiProvider,
    logger,
    maxScriptChars = 50000,
  } = options;

  return {
    isAiConfigured(): boolean {
      return directorAiProvider.isConfigured();
    },

    async getPlan(projectId: string): Promise<DirectorPlan | null> {
      const project = await projectRepository.findById(projectId);
      if (!project) {
        throw new NotFoundError("Project not found", { projectId });
      }
      return directorPlanRepository.findByProjectId(projectId);
    },

    async analyzeAndPlan(projectId: string, input: AnalyzeScriptInput): Promise<DirectorPlan> {
      const startTime = Date.now();

      // 1. Verify project exists
      const project = await projectRepository.findById(projectId);
      if (!project) {
        throw new NotFoundError("Project not found", { projectId });
      }

      // 2. Validate script
      const script = input.script;
      if (!script || script.trim().length === 0) {
        throw new ValidationError("Script cannot be empty or only whitespace");
      }
      if (script.length > maxScriptChars) {
        throw new ValidationError(
          `Script length (${script.length} characters) exceeds the maximum limit of ${maxScriptChars} characters`
        );
      }

      // 3. Resolve and validate Brand / Product context
      let brandContext: BrandContextForDirector | undefined;
      let productContext: ProductContextForDirector | undefined;

      if (input.brandId) {
        const brand = await brandRepository.findById(input.brandId);
        if (!brand) {
          throw new NotFoundError("Brand not found", { brandId: input.brandId });
        }
        brandContext = { name: brand.name };
      }

      if (input.productId) {
        const product = await productRepository.findById(input.productId);
        if (!product) {
          throw new NotFoundError("Product not found", { productId: input.productId });
        }

        if (input.brandId && product.brandId !== input.brandId) {
          throw new ValidationError("Selected Product does not belong to the selected Brand", {
            productId: input.productId,
            brandId: input.brandId,
          });
        }

        // Auto-populate brand context if not already explicitly provided
        if (!brandContext) {
          const brand = await brandRepository.findById(product.brandId);
          if (brand) {
            brandContext = { name: brand.name };
          }
        }

        productContext = {
          name: product.name,
          description: product.description ?? null,
          aliases: product.aliases ? product.aliases.map((a) => a.alias) : [],
        };
      }

      // 4. Compute script SHA-256 hash
      const scriptHash = createHash("sha256").update(script, "utf8").digest("hex");

      // 5. Deterministically unitize script
      const scriptUnits = unitizeScript(script);
      if (scriptUnits.length === 0) {
        throw new ValidationError("Failed to produce script units from input");
      }

      // 6. Assert AI Provider configuration
      if (!directorAiProvider.isConfigured()) {
        throw new ProviderError(
          directorAiProvider.id,
          "Gemini AI provider is not configured. Please set GEMINI_API_KEY.",
          { isConfigured: false }
        );
      }

      // 7. Initial AI generation
      const rawOutput = await directorAiProvider.analyze({
        scriptUnits,
        brandContext,
        productContext,
      });

      // 8. Validate 10 coverage invariants + cross-field rules
      let validation = validateAndReconstructPlan(rawOutput, scriptUnits, script);
      let finalRawOutput = rawOutput;

      // 9. Single bounded repair attempt if invalid
      if (!validation.success || !validation.scenes) {
        logger.warn({
          event: "director.validation_repair",
          projectId,
          scriptHash,
          errorCount: validation.errors.length,
          message: `Director plan failed initial validation with ${validation.errors.length} errors; executing 1 bounded repair attempt`,
        });

        const repairedRawOutput = await directorAiProvider.repair({
          scriptUnits,
          brandContext,
          productContext,
          rawOutput,
          validationErrors: validation.errors,
        });

        validation = validateAndReconstructPlan(repairedRawOutput, scriptUnits, script);

        if (!validation.success || !validation.scenes) {
          throw new ProviderError(
            directorAiProvider.id,
            "Director scene plan failed invariant validation after 1 repair attempt",
            {
              validationErrors: validation.errors,
            }
          );
        }

        finalRawOutput = repairedRawOutput;
      }

      const validatedScenes: DirectorScene[] = validation.scenes;
      const actualModel = finalRawOutput.model || directorAiProvider.modelName;

      // 10. Atomically replace DirectorPlan and DirectorScenes in database
      const savedPlan = await directorPlanRepository.replacePlan(
        projectId,
        {
          projectId,
          originalScript: script,
          scriptHash,
          unitizerVersion: UNITIZER_VERSION,
          schemaVersion: DIRECTOR_SCHEMA_VERSION,
          promptVersion: DIRECTOR_PROMPT_VERSION,
          model: actualModel,
          language: finalRawOutput.language,
          contentType: finalRawOutput.contentType,
          summary: finalRawOutput.summary,
          creativeDirection: finalRawOutput.creativeDirection,
          brandId: input.brandId ?? null,
          productId: input.productId ?? null,
        },
        validatedScenes.map((s) => ({
          order: s.order,
          text: s.text,
          unitIds: s.unitIds,
          purpose: s.purpose,
          visualBrief: s.visualBrief,
          visualSourceHint: s.visualSourceHint,
          shotType: s.shotType,
          mood: s.mood,
          setting: s.setting,
          subject: s.subject,
          productPresence: s.productPresence,
          searchQuery: s.searchQuery,
          keywords: s.keywords,
          manualAiPrompt: s.manualAiPrompt,
          sourceSpanStart: s.sourceSpanStart,
          sourceSpanEnd: s.sourceSpanEnd,
        }))
      );

      const latencyMs = Date.now() - startTime;
      logger.info({
        event: "director.plan_generated",
        projectId,
        scriptCharCount: script.length,
        scriptHash,
        model: actualModel,
        promptVersion: DIRECTOR_PROMPT_VERSION,
        sceneCount: savedPlan.scenes.length,
        latencyMs,
      });

      return savedPlan;
    },
  };
}
