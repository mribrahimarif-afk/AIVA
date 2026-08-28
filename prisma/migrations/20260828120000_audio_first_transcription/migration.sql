-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_director_plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "originalScript" TEXT NOT NULL,
    "scriptHash" TEXT NOT NULL,
    "unitizerVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "creativeDirection" TEXT NOT NULL,
    "brandId" TEXT,
    "productId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'SCRIPT',
    "sourceTranscriptionId" TEXT,
    "sourceAudioHash" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "director_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_director_plans" ("brandId", "contentType", "creativeDirection", "generatedAt", "id", "language", "model", "originalScript", "productId", "projectId", "promptVersion", "schemaVersion", "scriptHash", "summary", "unitizerVersion") SELECT "brandId", "contentType", "creativeDirection", "generatedAt", "id", "language", "model", "originalScript", "productId", "projectId", "promptVersion", "schemaVersion", "scriptHash", "summary", "unitizerVersion" FROM "director_plans";
DROP TABLE "director_plans";
ALTER TABLE "new_director_plans" RENAME TO "director_plans";
CREATE UNIQUE INDEX "director_plans_projectId_key" ON "director_plans"("projectId");
CREATE INDEX "director_plans_projectId_idx" ON "director_plans"("projectId");
CREATE INDEX "director_plans_scriptHash_idx" ON "director_plans"("scriptHash");
CREATE INDEX "director_plans_sourceType_idx" ON "director_plans"("sourceType");
CREATE INDEX "director_plans_sourceTranscriptionId_idx" ON "director_plans"("sourceTranscriptionId");

-- CreateTable
CREATE TABLE "audio_sources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "storageRef" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "originalDisplayName" TEXT,
    "activeTranscriptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audio_sources_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transcriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "audioSourceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestedMode" TEXT NOT NULL,
    "displayText" TEXT NOT NULL,
    "canonicalText" TEXT NOT NULL,
    "detectedLanguage" TEXT,
    "durationMs" INTEGER NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "sourceAudioHash" TEXT NOT NULL,
    "configurationHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transcriptions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "transcriptions_audioSourceId_fkey" FOREIGN KEY ("audioSourceId") REFERENCES "audio_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "transcription_words" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transcriptionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "sourceStart" INTEGER NOT NULL,
    "sourceEnd" INTEGER NOT NULL,
    "speaker" TEXT,
    "confidence" REAL,
    "locale" TEXT,
    CONSTRAINT "transcription_words_transcriptionId_fkey" FOREIGN KEY ("transcriptionId") REFERENCES "transcriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "audio_sources_projectId_idx" ON "audio_sources"("projectId");
CREATE INDEX "audio_sources_sourceHash_idx" ON "audio_sources"("sourceHash");

-- CreateIndex
CREATE INDEX "transcriptions_projectId_idx" ON "transcriptions"("projectId");
CREATE INDEX "transcriptions_audioSourceId_idx" ON "transcriptions"("audioSourceId");
CREATE INDEX "transcriptions_sourceAudioHash_idx" ON "transcriptions"("sourceAudioHash");
CREATE INDEX "transcriptions_configurationHash_idx" ON "transcriptions"("configurationHash");

-- CreateIndex
CREATE UNIQUE INDEX "transcription_words_transcriptionId_sequence_key" ON "transcription_words"("transcriptionId", "sequence");
CREATE INDEX "transcription_words_transcriptionId_idx" ON "transcription_words"("transcriptionId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
