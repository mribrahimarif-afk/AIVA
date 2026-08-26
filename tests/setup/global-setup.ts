import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const TEST_DB_PATH = path.join(ROOT, "prisma", "test.db");
const TEST_STORAGE_ROOT = path.join(ROOT, ".test-storage");

function cleanup(): void {
  for (const file of [TEST_DB_PATH, `${TEST_DB_PATH}-journal`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  if (fs.existsSync(TEST_STORAGE_ROOT)) {
    fs.rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true });
  }
}

/**
 * Runs once before the whole test suite: builds a fresh SQLite test
 * database from the real Prisma migrations (not `db push`), so
 * integration tests exercise the same migration path used in
 * development/production.
 */
export async function setup(): Promise<void> {
  cleanup();
  execSync("npx prisma migrate deploy", {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
    stdio: "inherit",
  });
}

export async function teardown(): Promise<void> {
  cleanup();
}
