import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Ensures the parent directory for a SQLite database file exists before Prisma Client initializes.
 * Resolves relative file: URLs relative to the Prisma schema directory (prisma/).
 */
export function ensureSqliteParentDir(customDbUrl?: string): string {
  const dbUrl = customDbUrl || process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith("file:")) return "";

  try {
    const relativeOrAbsPath = dbUrl.replace(/^file:/, "").split("?")[0] || "";
    if (!relativeOrAbsPath) return "";

    const schemaDir = path.resolve(process.cwd(), "prisma");
    const absPath = path.isAbsolute(relativeOrAbsPath)
      ? relativeOrAbsPath
      : path.resolve(schemaDir, relativeOrAbsPath);

    const parentDir = path.dirname(absPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    return absPath;
  } catch {
    return "";
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
