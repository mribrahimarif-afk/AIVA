import { z } from "zod";
import { ASPECT_RATIOS, PROJECT_STATUSES } from "./project.types";

export const projectStatusSchema = z.enum(PROJECT_STATUSES);

export const aspectRatioSchema = z.enum(ASPECT_RATIOS);

/**
 * Input accepted from the "Create New Project" UI / API. Deliberately
 * narrow: only what TASK-001's project creation flow needs.
 */
export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required")
    .max(200, "Project name must be 200 characters or fewer"),
  script: z
    .string()
    .max(50_000, "Script must be 50,000 characters or fewer")
    .default(""),
  aspectRatio: aspectRatioSchema.default("9:16"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const projectIdSchema = z.string().trim().min(1, "Project id is required");
