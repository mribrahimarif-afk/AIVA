import path from "node:path";
import { resetEnvCache } from "@/infrastructure/config/env";

const ROOT = path.resolve(__dirname, "../..");

// NODE_ENV is set to "test" by Vitest automatically; not reassigned here
// because @types/node marks it read-only.
process.env.DATABASE_URL = `file:${path.join(ROOT, "prisma", "test.db")}`;
process.env.AIVA_STORAGE_ROOT = path.join(ROOT, ".test-storage");
process.env.AIVA_LOG_LEVEL = "error";
process.env.AIVA_DEFAULT_ASPECT_RATIO = "9:16";
process.env.AIVA_FFMPEG_PATH = "";

resetEnvCache();
