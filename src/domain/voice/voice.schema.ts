import { z } from "zod";
import { SUPPORTED_VOICES } from "./voice.types";

export const generateVoiceSchema = z.object({
  voiceName: z
    .enum(SUPPORTED_VOICES, {
      errorMap: () => ({ message: "Unsupported voice profile" }),
    })
    .optional(),
  force: z.boolean().optional().default(false),
});

export type GenerateVoiceSchema = z.infer<typeof generateVoiceSchema>;

export const voiceTrackQuerySchema = z.object({
  projectId: z.string().trim().min(1, "projectId is required"),
});
