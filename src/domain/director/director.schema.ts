import { z } from "zod";
import {
  DIRECTOR_LANGUAGES,
  DIRECTOR_CONTENT_TYPES,
  SCENE_PURPOSES,
  VISUAL_SOURCE_HINTS,
  SHOT_TYPES,
  PRODUCT_PRESENCE_OPTIONS,
} from "./director.types";

export const directorLanguageSchema = z.enum(DIRECTOR_LANGUAGES);
export const directorContentTypeSchema = z.enum(DIRECTOR_CONTENT_TYPES);
export const scenePurposeSchema = z.enum(SCENE_PURPOSES);
export const visualSourceHintSchema = z.enum(VISUAL_SOURCE_HINTS);
export const shotTypeSchema = z.enum(SHOT_TYPES);
export const productPresenceSchema = z.enum(PRODUCT_PRESENCE_OPTIONS);

export const rawDirectorSceneSchema = z.object({
  order: z.number().int().positive(),
  unitIds: z.array(z.string().trim().min(1)).min(1),
  purpose: scenePurposeSchema,
  visualBrief: z.string().trim().min(10).max(500),
  visualSourceHint: visualSourceHintSchema,
  shotType: shotTypeSchema,
  mood: z.string().trim().min(2).max(50),
  setting: z.string().trim().min(2).max(100),
  subject: z.string().trim().min(2).max(100),
  productPresence: productPresenceSchema,
  searchQuery: z.string().trim().min(3).max(200),
  keywords: z.array(z.string().trim().min(1).max(50)).min(1).max(15),
  manualAiPrompt: z.string().trim().min(10).max(1000).nullable(),
});

export const rawDirectorOutputSchema = z.object({
  language: directorLanguageSchema,
  contentType: directorContentTypeSchema,
  summary: z.string().trim().min(10).max(1000),
  creativeDirection: z.string().trim().min(10).max(1000),
  scenes: z.array(rawDirectorSceneSchema).min(1).max(100),
});

export const analyzeScriptInputSchema = z.object({
  script: z
    .string()
    .refine((val) => val.trim().length > 0, {
      message: "Script cannot be empty or only whitespace",
    })
    .refine((val) => val.length <= 50000, {
      message: "Script exceeds maximum character limit of 50,000 characters",
    }),
  brandId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
});

export type AnalyzeScriptInput = z.infer<typeof analyzeScriptInputSchema>;
