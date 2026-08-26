/**
 * All future-safe project lifecycle states. Later tasks will drive
 * transitions between these; TASK-001 only persists and displays them.
 */
export const PROJECT_STATUSES = [
  "DRAFT",
  "SCRIPT_READY",
  "PLANNING",
  "PLAN_READY",
  "VOICE_GENERATING",
  "VOICE_READY",
  "ASSETS_RESOLVING",
  "ASSETS_READY",
  "AWAITING_AI_ASSET",
  "READY_TO_RENDER",
  "RENDERING",
  "COMPLETED",
  "FAILED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface Project {
  id: string;
  name: string;
  script: string;
  status: ProjectStatus;
  aspectRatio: AspectRatio;
  createdAt: Date;
  updatedAt: Date;
}
