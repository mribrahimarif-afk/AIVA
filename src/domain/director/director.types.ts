export const DIRECTOR_SCHEMA_VERSION = "1";
export const DIRECTOR_PROMPT_VERSION = "director-v1";

export const DIRECTOR_LANGUAGES = [
  "ENGLISH",
  "URDU",
  "ROMAN_URDU",
  "MIXED",
  "OTHER",
] as const;

export type DirectorLanguage = (typeof DIRECTOR_LANGUAGES)[number];

export const DIRECTOR_CONTENT_TYPES = [
  "ADVERTISEMENT",
  "SOCIAL_REEL",
  "EXPLAINER",
  "EDUCATIONAL",
  "STORY",
  "PRODUCT_SHOWCASE",
  "TESTIMONIAL_STYLE",
  "OTHER",
] as const;

export type DirectorContentType = (typeof DIRECTOR_CONTENT_TYPES)[number];

export const SCENE_PURPOSES = [
  "HOOK",
  "PROBLEM",
  "CONTEXT",
  "EDUCATION",
  "DEMONSTRATION",
  "PRODUCT",
  "PROOF",
  "TRANSITION",
  "CTA",
  "OTHER",
] as const;

export type ScenePurpose = (typeof SCENE_PURPOSES)[number];

export const VISUAL_SOURCE_HINTS = [
  "PRODUCT_LIBRARY",
  "REUSABLE_LIBRARY",
  "STOCK",
  "MANUAL_AI",
  "FLEXIBLE",
] as const;

export type VisualSourceHint = (typeof VISUAL_SOURCE_HINTS)[number];

export const SHOT_TYPES = [
  "PRODUCT_HERO",
  "PRODUCT_DETAIL",
  "LIFESTYLE",
  "TALKING_HEAD",
  "BROLL",
  "ENVIRONMENT",
  "TEXT_GRAPHIC",
  "ABSTRACT",
  "SCREEN",
  "OTHER",
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

export const PRODUCT_PRESENCE_OPTIONS = [
  "REQUIRED",
  "PREFERRED",
  "NOT_NEEDED",
] as const;

export type ProductPresence = (typeof PRODUCT_PRESENCE_OPTIONS)[number];

/**
 * Raw scene proposal produced by Gemini before local reconstruction and validation.
 */
export interface RawDirectorScene {
  order: number;
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
}

/**
 * Raw plan proposal produced by Gemini before local validation.
 */
export interface RawDirectorOutput {
  language: DirectorLanguage;
  contentType: DirectorContentType;
  summary: string;
  creativeDirection: string;
  scenes: RawDirectorScene[];
  model?: string;
}

/**
 * Fully validated, locally reconstructed Director scene.
 */
export interface DirectorScene {
  id?: string;
  directorPlanId?: string;
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
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Persisted and validated DirectorPlan domain model.
 */
export interface DirectorPlan {
  id: string;
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
  brandId: string | null;
  productId: string | null;
  generatedAt: Date;
  scenes: DirectorScene[];
}
