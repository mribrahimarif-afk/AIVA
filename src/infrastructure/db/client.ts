import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Ensures the parent directory for a SQLite database file exists before Prisma Client initializes.
 */
function ensureSqliteParentDir(): void {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith("file:")) return;

  try {
    const relativeOrAbsPath = dbUrl.replace(/^file:/, "").split("?")[0] || "";
    if (!relativeOrAbsPath) return;

    const absPath = path.isAbsolute(relativeOrAbsPath)
      ? relativeOrAbsPath
      : path.resolve(process.cwd(), relativeOrAbsPath);

    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  } catch {
    // Fail soft if process.env.DATABASE_URL isn't standard file: protocol
  }
}

ensureSqliteParentDir();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
