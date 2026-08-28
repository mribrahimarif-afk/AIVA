import type { PrismaClient, Timeline, TimelineScene } from "@prisma/client";
import type { TimelineDto, TimelineSceneDto, TimingSourceType } from "@/domain/timeline";

type TimelineRow = Timeline & { scenes: TimelineScene[] };
function map(row: TimelineRow): TimelineDto { return { ...row, timingSourceType: row.timingSourceType as TimingSourceType, scenes: row.scenes.map((scene) => ({ ...scene })) }; }
export function createTimelineRepository(db: PrismaClient) {
  return {
    async findByIdentity(directorPlanId: string, timingSourceType: TimingSourceType, timingSourceId: string) {
      const row = await db.timeline.findUnique({ where: { directorPlanId_timingSourceType_timingSourceId: { directorPlanId, timingSourceType, timingSourceId } }, include: { scenes: { orderBy: { sequence: "asc" } } } });
      return row ? map(row) : null;
    },
    async findCurrent(projectId: string, directorPlanId: string) {
      const row = await db.timeline.findFirst({ where: { projectId, directorPlanId }, orderBy: { createdAt: "desc" }, include: { scenes: { orderBy: { sequence: "asc" } } } });
      return row ? map(row) : null;
    },
    async create(data: { projectId: string; directorPlanId: string; timingSourceType: TimingSourceType; timingSourceId: string; totalDurationMs: number; scenes: TimelineSceneDto[] }) {
      return db.$transaction(async (tx) => {
        const existing = await tx.timeline.findUnique({ where: { directorPlanId_timingSourceType_timingSourceId: { directorPlanId: data.directorPlanId, timingSourceType: data.timingSourceType, timingSourceId: data.timingSourceId } }, include: { scenes: { orderBy: { sequence: "asc" } } } });
        if (existing) return map(existing);
        const row = await tx.timeline.create({ data: { projectId: data.projectId, directorPlanId: data.directorPlanId, timingSourceType: data.timingSourceType, timingSourceId: data.timingSourceId, totalDurationMs: data.totalDurationMs, scenes: { create: data.scenes.map((scene) => ({ directorSceneId: scene.directorSceneId, sequence: scene.sequence, sourceStart: scene.sourceStart, sourceEnd: scene.sourceEnd, startMs: scene.startMs, endMs: scene.endMs, durationMs: scene.durationMs })) } }, include: { scenes: { orderBy: { sequence: "asc" } } } });
        return map(row);
      });
    },
  };
}
