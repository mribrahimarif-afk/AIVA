-- CreateTable
CREATE TABLE "director_plans" (
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
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "director_plans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "director_scenes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "directorPlanId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "unitIds" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "visualBrief" TEXT NOT NULL,
    "visualSourceHint" TEXT NOT NULL,
    "shotType" TEXT NOT NULL,
    "mood" TEXT NOT NULL,
    "setting" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "productPresence" TEXT NOT NULL,
    "searchQuery" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "manualAiPrompt" TEXT,
    "sourceSpanStart" INTEGER NOT NULL,
    "sourceSpanEnd" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "director_scenes_directorPlanId_fkey" FOREIGN KEY ("directorPlanId") REFERENCES "director_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "director_plans_projectId_key" ON "director_plans"("projectId");
CREATE INDEX "director_plans_projectId_idx" ON "director_plans"("projectId");
CREATE INDEX "director_plans_scriptHash_idx" ON "director_plans"("scriptHash");

-- CreateIndex
CREATE INDEX "director_scenes_directorPlanId_idx" ON "director_scenes"("directorPlanId");
CREATE UNIQUE INDEX "director_scenes_directorPlanId_order_key" ON "director_scenes"("directorPlanId", "order");
