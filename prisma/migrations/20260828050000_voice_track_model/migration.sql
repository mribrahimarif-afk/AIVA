-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_voice_tracks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "directorPlanId" TEXT NOT NULL,
    "sourceScriptHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'azure-speech',
    "model" TEXT NOT NULL DEFAULT 'azure-neural',
    "voiceName" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "outputFormat" TEXT NOT NULL,
    "audioSha256" TEXT NOT NULL,
    "audioByteCount" INTEGER NOT NULL,
    "audioStorageRef" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voice_tracks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "voice_tracks_directorPlanId_fkey" FOREIGN KEY ("directorPlanId") REFERENCES "director_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_voice_tracks" ("audioByteCount", "audioSha256", "audioStorageRef", "directorPlanId", "durationMs", "generatedAt", "id", "locale", "outputFormat", "projectId", "provider", "sourceScriptHash", "voiceName") SELECT "audioByteCount", "audioSha256", "audioStorageRef", "directorPlanId", "durationMs", "generatedAt", "id", "locale", "outputFormat", "projectId", "provider", "sourceScriptHash", "voiceName" FROM "voice_tracks";
DROP TABLE "voice_tracks";
ALTER TABLE "new_voice_tracks" RENAME TO "voice_tracks";
CREATE UNIQUE INDEX "voice_tracks_projectId_key" ON "voice_tracks"("projectId");
CREATE INDEX "voice_tracks_projectId_idx" ON "voice_tracks"("projectId");
CREATE INDEX "voice_tracks_directorPlanId_idx" ON "voice_tracks"("directorPlanId");
CREATE INDEX "voice_tracks_sourceScriptHash_idx" ON "voice_tracks"("sourceScriptHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
