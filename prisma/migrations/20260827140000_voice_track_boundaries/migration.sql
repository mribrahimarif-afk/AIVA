-- CreateTable
CREATE TABLE "voice_tracks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "directorPlanId" TEXT NOT NULL,
    "sourceScriptHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'azure-speech',
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

-- CreateTable
CREATE TABLE "voice_boundaries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "voiceTrackId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "sourceStart" INTEGER NOT NULL,
    "sourceEnd" INTEGER NOT NULL,
    "audioStartMs" INTEGER NOT NULL,
    "audioDurationMs" INTEGER NOT NULL,
    CONSTRAINT "voice_boundaries_voiceTrackId_fkey" FOREIGN KEY ("voiceTrackId") REFERENCES "voice_tracks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_tracks_projectId_key" ON "voice_tracks"("projectId");

-- CreateIndex
CREATE INDEX "voice_tracks_projectId_idx" ON "voice_tracks"("projectId");

-- CreateIndex
CREATE INDEX "voice_tracks_directorPlanId_idx" ON "voice_tracks"("directorPlanId");

-- CreateIndex
CREATE INDEX "voice_tracks_sourceScriptHash_idx" ON "voice_tracks"("sourceScriptHash");

-- CreateIndex
CREATE UNIQUE INDEX "voice_boundaries_voiceTrackId_order_key" ON "voice_boundaries"("voiceTrackId", "order");

-- CreateIndex
CREATE INDEX "voice_boundaries_voiceTrackId_idx" ON "voice_boundaries"("voiceTrackId");
