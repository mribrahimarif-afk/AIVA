import { PrismaClient, Prisma } from "@prisma/client";
import { DomainError } from "@/domain/errors";
import { VoiceBoundaryDto, VoiceTrackAggregate } from "@/domain/voice";

export interface ReplaceVoiceTrackParams {
  projectId: string;
  directorPlanId: string;
  sourceScriptHash: string;
  provider: string;
  model?: string;
  voiceName: string;
  locale: string;
  outputFormat: string;
  audioSha256: string;
  audioByteCount: number;
  audioStorageRef: string;
  durationMs: number;
  boundaries: Omit<VoiceBoundaryDto, "id">[];
}

export interface VoiceTrackRepository {
  getCurrentForProject(projectId: string): Promise<VoiceTrackAggregate | null>;
  isAudioStorageReferenced(audioStorageRef: string): Promise<boolean>;
  replaceTrack(params: ReplaceVoiceTrackParams): Promise<VoiceTrackAggregate>;
}

export function createVoiceTrackRepository(prisma: PrismaClient): VoiceTrackRepository {
  return {
    async getCurrentForProject(projectId: string): Promise<VoiceTrackAggregate | null> {
      const track = await prisma.voiceTrack.findUnique({
        where: { projectId },
        include: {
          boundaries: {
            orderBy: { order: "asc" },
          },
        },
      });

      if (!track) return null;

      return {
        id: track.id,
        projectId: track.projectId,
        directorPlanId: track.directorPlanId,
        sourceScriptHash: track.sourceScriptHash,
        provider: track.provider,
        model: track.model,
        voiceName: track.voiceName,
        locale: track.locale,
        outputFormat: track.outputFormat,
        audioSha256: track.audioSha256,
        audioByteCount: track.audioByteCount,
        audioStorageRef: track.audioStorageRef,
        durationMs: track.durationMs,
        generatedAt: track.generatedAt,
        boundaries: track.boundaries.map((b) => ({
          id: b.id,
          voiceTrackId: b.voiceTrackId,
          order: b.order,
          sourceStart: b.sourceStart,
          sourceEnd: b.sourceEnd,
          audioStartMs: b.audioStartMs,
          audioDurationMs: b.audioDurationMs,
        })),
      };
    },

    async isAudioStorageReferenced(audioStorageRef: string): Promise<boolean> {
      const count = await prisma.voiceTrack.count({
        where: { audioStorageRef },
      });
      return count > 0;
    },

    async replaceTrack(params: ReplaceVoiceTrackParams): Promise<VoiceTrackAggregate> {
      const {
        projectId,
        directorPlanId,
        sourceScriptHash,
        provider,
        model = "azure-neural",
        voiceName,
        locale,
        outputFormat,
        audioSha256,
        audioByteCount,
        audioStorageRef,
        durationMs,
        boundaries,
      } = params;

      return await prisma.$transaction(async (tx) => {
        // 1. IN-TRANSACTION CONCURRENCY & TOCTOU GUARD:
        // Re-read current DirectorPlan and fail closed if identity or scriptHash changed.
        const currentDirectorPlan = await tx.directorPlan.findUnique({
          where: { projectId },
        });

        if (
          !currentDirectorPlan ||
          currentDirectorPlan.id !== directorPlanId ||
          currentDirectorPlan.scriptHash !== sourceScriptHash
        ) {
          throw new DomainError(
            "SOURCE_CHANGED",
            "Director script changed or was replaced during voice generation; aborting stale voice track persistence"
          );
        }

        // 2. Upsert the VoiceTrack for the project
        const voiceTrack = await tx.voiceTrack.upsert({
          where: { projectId },
          create: {
            projectId,
            directorPlanId,
            sourceScriptHash,
            provider,
            model,
            voiceName,
            locale,
            outputFormat,
            audioSha256,
            audioByteCount,
            audioStorageRef,
            durationMs,
            generatedAt: new Date(),
          },
          update: {
            directorPlanId,
            sourceScriptHash,
            provider,
            model,
            voiceName,
            locale,
            outputFormat,
            audioSha256,
            audioByteCount,
            audioStorageRef,
            durationMs,
            generatedAt: new Date(),
          },
        });

        // 3. Delete existing boundaries for this voice track
        await tx.voiceBoundary.deleteMany({
          where: { voiceTrackId: voiceTrack.id },
        });

        // 4. Bulk insert the new validated VoiceBoundaries
        if (boundaries.length > 0) {
          const boundaryData: Prisma.VoiceBoundaryCreateManyInput[] = boundaries.map((b) => ({
            voiceTrackId: voiceTrack.id,
            order: b.order,
            sourceStart: b.sourceStart,
            sourceEnd: b.sourceEnd,
            audioStartMs: b.audioStartMs,
            audioDurationMs: b.audioDurationMs,
          }));

          await tx.voiceBoundary.createMany({
            data: boundaryData,
          });
        }

        // 5. Read back the updated aggregate with ordered boundaries
        const persistedBoundaries = await tx.voiceBoundary.findMany({
          where: { voiceTrackId: voiceTrack.id },
          orderBy: { order: "asc" },
        });

        return {
          id: voiceTrack.id,
          projectId: voiceTrack.projectId,
          directorPlanId: voiceTrack.directorPlanId,
          sourceScriptHash: voiceTrack.sourceScriptHash,
          provider: voiceTrack.provider,
          model: voiceTrack.model,
          voiceName: voiceTrack.voiceName,
          locale: voiceTrack.locale,
          outputFormat: voiceTrack.outputFormat,
          audioSha256: voiceTrack.audioSha256,
          audioByteCount: voiceTrack.audioByteCount,
          audioStorageRef: voiceTrack.audioStorageRef,
          durationMs: voiceTrack.durationMs,
          generatedAt: voiceTrack.generatedAt,
          boundaries: persistedBoundaries.map((b) => ({
            id: b.id,
            voiceTrackId: b.voiceTrackId,
            order: b.order,
            sourceStart: b.sourceStart,
            sourceEnd: b.sourceEnd,
            audioStartMs: b.audioStartMs,
            audioDurationMs: b.audioDurationMs,
          })),
        };
      });
    },
  };
}
