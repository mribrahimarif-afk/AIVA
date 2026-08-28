import type { PrismaClient } from "@prisma/client";
import type { AudioSourceInfo } from "@/domain/transcription";

export interface CreateAudioSourceInput {
  projectId: string;
  storageRef: string;
  sourceHash: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  originalDisplayName?: string | null;
  activeTranscriptionId?: string | null;
}

export interface AudioSourceRepository {
  create(data: CreateAudioSourceInput): Promise<AudioSourceInfo>;
  findById(id: string): Promise<AudioSourceInfo | null>;
  findByProjectId(projectId: string): Promise<AudioSourceInfo[]>;
  findBySourceHash(projectId: string, sourceHash: string): Promise<AudioSourceInfo | null>;
  setActiveTranscription(audioSourceId: string, transcriptionId: string): Promise<AudioSourceInfo>;
  delete(id: string): Promise<void>;
}

export function createAudioSourceRepository(db: PrismaClient): AudioSourceRepository {
  return {
    async create(data: CreateAudioSourceInput): Promise<AudioSourceInfo> {
      const record = await db.audioSource.create({
        data: {
          projectId: data.projectId,
          storageRef: data.storageRef,
          sourceHash: data.sourceHash.toLowerCase(),
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          durationMs: data.durationMs ?? null,
          originalDisplayName: data.originalDisplayName ?? null,
          activeTranscriptionId: data.activeTranscriptionId ?? null,
        },
      });

      return {
        id: record.id,
        projectId: record.projectId,
        storageRef: record.storageRef,
        sourceHash: record.sourceHash,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        durationMs: record.durationMs,
        originalDisplayName: record.originalDisplayName,
        activeTranscriptionId: record.activeTranscriptionId,
        createdAt: record.createdAt,
      };
    },

    async findById(id: string): Promise<AudioSourceInfo | null> {
      const record = await db.audioSource.findUnique({
        where: { id },
      });

      if (!record) return null;

      return {
        id: record.id,
        projectId: record.projectId,
        storageRef: record.storageRef,
        sourceHash: record.sourceHash,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        durationMs: record.durationMs,
        originalDisplayName: record.originalDisplayName,
        activeTranscriptionId: record.activeTranscriptionId,
        createdAt: record.createdAt,
      };
    },

    async findByProjectId(projectId: string): Promise<AudioSourceInfo[]> {
      const records = await db.audioSource.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
      });

      return records.map((record) => ({
        id: record.id,
        projectId: record.projectId,
        storageRef: record.storageRef,
        sourceHash: record.sourceHash,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        durationMs: record.durationMs,
        originalDisplayName: record.originalDisplayName,
        activeTranscriptionId: record.activeTranscriptionId,
        createdAt: record.createdAt,
      }));
    },

    async findBySourceHash(projectId: string, sourceHash: string): Promise<AudioSourceInfo | null> {
      const record = await db.audioSource.findFirst({
        where: {
          projectId,
          sourceHash: sourceHash.toLowerCase(),
        },
        orderBy: { createdAt: "desc" },
      });

      if (!record) return null;

      return {
        id: record.id,
        projectId: record.projectId,
        storageRef: record.storageRef,
        sourceHash: record.sourceHash,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        durationMs: record.durationMs,
        originalDisplayName: record.originalDisplayName,
        activeTranscriptionId: record.activeTranscriptionId,
        createdAt: record.createdAt,
      };
    },

    async setActiveTranscription(
      audioSourceId: string,
      transcriptionId: string
    ): Promise<AudioSourceInfo> {
      const record = await db.audioSource.update({
        where: { id: audioSourceId },
        data: { activeTranscriptionId: transcriptionId },
      });

      return {
        id: record.id,
        projectId: record.projectId,
        storageRef: record.storageRef,
        sourceHash: record.sourceHash,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        durationMs: record.durationMs,
        originalDisplayName: record.originalDisplayName,
        activeTranscriptionId: record.activeTranscriptionId,
        createdAt: record.createdAt,
      };
    },

    async delete(id: string): Promise<void> {
      await db.audioSource.delete({
        where: { id },
      });
    },
  };
}
