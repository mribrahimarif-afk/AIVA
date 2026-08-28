CREATE TABLE "timelines" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "directorPlanId" TEXT NOT NULL,
  "timingSourceType" TEXT NOT NULL,
  "timingSourceId" TEXT NOT NULL,
  "totalDurationMs" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "timelines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timelines_directorPlanId_fkey" FOREIGN KEY ("directorPlanId") REFERENCES "director_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "timeline_scenes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "timelineId" TEXT NOT NULL,
  "directorSceneId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "sourceStart" INTEGER NOT NULL,
  "sourceEnd" INTEGER NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  CONSTRAINT "timeline_scenes_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "timelines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "timelines_directorPlanId_timingSourceType_timingSourceId_key" ON "timelines"("directorPlanId", "timingSourceType", "timingSourceId");
CREATE INDEX "timelines_projectId_createdAt_idx" ON "timelines"("projectId", "createdAt");
CREATE INDEX "timelines_directorPlanId_idx" ON "timelines"("directorPlanId");
CREATE UNIQUE INDEX "timeline_scenes_timelineId_sequence_key" ON "timeline_scenes"("timelineId", "sequence");
CREATE INDEX "timeline_scenes_timelineId_idx" ON "timeline_scenes"("timelineId");
CREATE INDEX "timeline_scenes_directorSceneId_idx" ON "timeline_scenes"("directorSceneId");
