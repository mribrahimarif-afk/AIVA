import { z } from "zod";
import { ASPECT_RATIOS } from "@/domain/project";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  AIVA_STORAGE_ROOT: z.string().trim().min(1).default("./storage"),
  AIVA_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(524288000), // Default: 500 MB limit
  AIVA_FFMPEG_PATH: z.string().trim().optional().default(""),
  AIVA_DEFAULT_ASPECT_RATIO: z.enum(ASPECT_RATIOS).default("9:16"),
  AIVA_LOG_LEVEL: logLevelSchema.default("info"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.7-flash"),
  GEMINI_DIRECTOR_FALLBACK_MODEL: z.string().trim().min(1).default("gemini-3.6-flash"),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  DIRECTOR_MAX_SCRIPT_CHARS: z.coerce.number().int().positive().default(50000),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_DIRECTOR_MODEL: z.string().trim().min(1).default("minimax/minimax-m3:free"),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  AZURE_SPEECH_KEY: z.string().optional().default(""),
  AZURE_SPEECH_REGION: z.string().optional().default(""),
  AZURE_SPEECH_VOICE: z.string().trim().optional().default("ur-PK-AsadNeural"),
  VOICE_MAX_DURATION_MS: z.coerce.number().int().positive().max(3600000).default(600000),
  VOICE_SYNTHESIS_TIMEOUT_MS: z.coerce.number().int().positive().min(5000).max(300000).default(60000),
  VOICE_MAX_AUDIO_BYTES: z.coerce.number().int().positive().min(1024).max(104857600).default(67108864),
  PEXELS_API_KEY: z.string().optional().default(""),
  PIXABAY_API_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = undefined;
}
