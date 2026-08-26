import { z } from "zod";
import { ASPECT_RATIOS } from "@/domain/project";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  AIVA_STORAGE_ROOT: z.string().trim().min(1).default("./storage"),
  AIVA_FFMPEG_PATH: z.string().trim().optional().default(""),
  AIVA_DEFAULT_ASPECT_RATIO: z.enum(ASPECT_RATIOS).default("9:16"),
  AIVA_LOG_LEVEL: logLevelSchema.default("info"),
  GEMINI_API_KEY: z.string().optional().default(""),
  AZURE_SPEECH_KEY: z.string().optional().default(""),
  AZURE_SPEECH_REGION: z.string().optional().default(""),
  PEXELS_API_KEY: z.string().optional().default(""),
  PIXABAY_API_KEY: z.string().optional().default(""),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Parses and validates process.env once per process. Throws immediately
 * (fail-fast at startup) if required configuration is missing or malformed,
 * rather than letting an invalid value surface later as a confusing runtime
 * error deep in a service.
 */
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

/** Test-only: clears the cached env so a test can re-parse process.env. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}
