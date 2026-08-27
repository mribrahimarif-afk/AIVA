import { z } from "zod";
import { SUPPORTED_VOICES, VOICE_PROVIDERS } from "./voice.types";

export const voiceProviderSchema = z
  .enum(["AZURE", "ELEVENLABS", "azure-speech", "azure", "elevenlabs"], {
    errorMap: () => ({ message: "Unsupported voice provider" }),
  })
  .transform((val): (typeof VOICE_PROVIDERS)[number] => {
    if (val === "azure-speech" || val === "azure" || val === "AZURE") {
      return "AZURE";
    }
    return "ELEVENLABS";
  });

export const generateVoiceSchema = z
  .object({
    provider: voiceProviderSchema.optional().default("AZURE"),
    voiceName: z.string().trim().min(1, "voiceName cannot be empty").optional(),
    force: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.provider === "AZURE" && data.voiceName) {
      if (!(SUPPORTED_VOICES as readonly string[]).includes(data.voiceName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["voiceName"],
          message: "Unsupported voice profile",
        });
      }
    }
  });

export type GenerateVoiceSchema = z.infer<typeof generateVoiceSchema>;

export const voiceTrackQuerySchema = z.object({
  projectId: z.string().trim().min(1, "projectId is required"),
});
