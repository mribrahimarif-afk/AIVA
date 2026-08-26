import { z } from "zod";
import { SCENE_STATUSES } from "./scene.types";

export const sceneStatusSchema = z.enum(SCENE_STATUSES);

export const createSceneSchema = z.object({
  projectId: z.string().trim().min(1),
  sequence: z.number().int().nonnegative(),
  text: z.string().trim().min(1, "Scene text is required"),
});

export type CreateSceneInput = z.infer<typeof createSceneSchema>;
