import { z } from "zod";
import { TRANSCRIPTION_MODES } from "./transcription.types";

export const transcriptionModeSchema = z.enum(TRANSCRIPTION_MODES);

export const transcribeRequestSchema = z.object({
  audioSourceId: z.string().trim().min(1, "audioSourceId is required"),
  mode: transcriptionModeSchema.default("AUTO"),
  force: z.boolean().optional().default(false),
});

export type TranscribeRequestInput = z.infer<typeof transcribeRequestSchema>;

export const useWithDirectorSchema = z.object({
  brandId: z.string().trim().optional(),
  productId: z.string().trim().optional(),
});

export type UseWithDirectorInput = z.infer<typeof useWithDirectorSchema>;
