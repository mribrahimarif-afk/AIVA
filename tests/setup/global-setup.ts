import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const TEST_DB_PATH = path.join(ROOT, "prisma", "test.db");
const TEST_STORAGE_ROOT = path.join(ROOT, ".test-storage");

function cleanup(): void {
  for (const file of [
    TEST_DB_PATH,
    `${TEST_DB_PATH}-journal`,
    `${TEST_DB_PATH}-wal`,
    `${TEST_DB_PATH}-shm`,
  ]) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Wait 100ms and try once more on Windows
        try {
          execSync("timeout /t 1 >nul 2>&1 || ping 127.0.0.1 -n 1 >nul");
          if (fs.existsSync(file)) fs.rmSync(file, { force: true });
        } catch {
          // Ignore
        }
      }
    }
  }
  if (fs.existsSync(TEST_STORAGE_ROOT)) {
    try {
      fs.rmSync(TEST_STORAGE_ROOT, { recursive: true, force: true });
    } catch {
      // Ignore
    }
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
  // Do not delete DB on teardown to avoid Windows file lock race with exiting worker processes
}
