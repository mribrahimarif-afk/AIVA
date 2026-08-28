import type { PrismaClient } from "@prisma/client";
import type {
  DirectorPlan,
  DirectorLanguage,
  DirectorContentType,
  ScenePurpose,
  VisualSourceHint,
  ShotType,
  ProductPresence,
} from "@/domain/director";
import { toDirectorPlan } from "./mappers";

export interface CreateDirectorPlanRecord {
  projectId: string;
  originalScript: string;
  scriptHash: string;
  unitizerVersion: string;
  schemaVersion: string;
  promptVersion: string;
  model: string;
  language: DirectorLanguage;
  contentType: DirectorContentType;
  summary: string;
  creativeDirection: string;
  brandId?: string | null;
  productId?: string | null;
  sourceType?: string;
  sourceTranscriptionId?: string | null;
  sourceAudioHash?: string | null;
}

export interface CreateDirectorSceneRecord {
  order: number;
  text: string;
  unitIds: string[];
  purpose: ScenePurpose;
  visualBrief: string;
  visualSourceHint: VisualSourceHint;
  shotType: ShotType;
  mood: string;
  setting: string;
  subject: string;
  productPresence: ProductPresence;
  searchQuery: string;
  keywords: string[];
  manualAiPrompt: string | null;
  sourceSpanStart: number;
  sourceSpanEnd: number;
}

export interface DirectorPlanRepository {
  findByProjectId(projectId: string): Promise<DirectorPlan | null>;
  replacePlan(
    projectId: string,
    plan: CreateDirectorPlanRecord,
    scenes: CreateDirectorSceneRecord[]
  ): Promise<DirectorPlan>;
}

export function createDirectorPlanRepository(db: PrismaClient): DirectorPlanRepository {
  return {
    async findByProjectId(projectId) {
      const row = await db.directorPlan.findUnique({
        where: { projectId },
        include: {
          scenes: {
            orderBy: { order: "asc" },
          },
        },
      });

      return row ? toDirectorPlan(row) : null;
    },

    async replacePlan(projectId, plan, scenes) {
      const result = await db.$transaction(async (tx) => {
        // 1. Atomically update Project.script with exactScript to ensure 100% source consistency
        await tx.project.update({
          where: { id: projectId },
          data: {
            script: plan.originalScript,
          },
        });

        // 2. Upsert the DirectorPlan entity, explicitly stamping generatedAt
        const savedPlan = await tx.directorPlan.upsert({
          where: { projectId },
          create: {
            projectId,
            originalScript: plan.originalScript,
            scriptHash: plan.scriptHash,
            unitizerVersion: plan.unitizerVersion,
            schemaVersion: plan.schemaVersion,
            promptVersion: plan.promptVersion,
            model: plan.model,
            language: plan.language,
            contentType: plan.contentType,
            summary: plan.summary,
            creativeDirection: plan.creativeDirection,
            brandId: plan.brandId ?? null,
            productId: plan.productId ?? null,
            sourceType: plan.sourceType || "SCRIPT",
            sourceTranscriptionId: plan.sourceTranscriptionId ?? null,
            sourceAudioHash: plan.sourceAudioHash ?? null,
            generatedAt: new Date(),
          },
          update: {
            originalScript: plan.originalScript,
            scriptHash: plan.scriptHash,
            unitizerVersion: plan.unitizerVersion,
            schemaVersion: plan.schemaVersion,
            promptVersion: plan.promptVersion,
            model: plan.model,
            language: plan.language,
            contentType: plan.contentType,
            summary: plan.summary,
            creativeDirection: plan.creativeDirection,
            brandId: plan.brandId ?? null,
            productId: plan.productId ?? null,
            sourceType: plan.sourceType || "SCRIPT",
            sourceTranscriptionId: plan.sourceTranscriptionId ?? null,
            sourceAudioHash: plan.sourceAudioHash ?? null,
            generatedAt: new Date(),
          },
        });

        // 2. Delete previous Director-owned scenes for this plan
        await tx.directorScene.deleteMany({
          where: { directorPlanId: savedPlan.id },
        });

        // 3. Bulk insert the new Director scenes
        if (scenes.length > 0) {
          await tx.directorScene.createMany({
            data: scenes.map((s) => ({
              directorPlanId: savedPlan.id,
              order: s.order,
              text: s.text,
              unitIds: JSON.stringify(s.unitIds),
              purpose: s.purpose,
              visualBrief: s.visualBrief,
              visualSourceHint: s.visualSourceHint,
              shotType: s.shotType,
              mood: s.mood,
              setting: s.setting,
              subject: s.subject,
              productPresence: s.productPresence,
              searchQuery: s.searchQuery,
              keywords: JSON.stringify(s.keywords),
              manualAiPrompt: s.manualAiPrompt ?? null,
              sourceSpanStart: s.sourceSpanStart,
              sourceSpanEnd: s.sourceSpanEnd,
            })),
          });
        }

        // 4. Fetch complete updated plan with ordered scenes
        const completePlan = await tx.directorPlan.findUniqueOrThrow({
          where: { id: savedPlan.id },
          include: {
            scenes: {
              orderBy: { order: "asc" },
            },
          },
        });

        return toDirectorPlan(completePlan);
      });

      return result;
    },
  };
}
