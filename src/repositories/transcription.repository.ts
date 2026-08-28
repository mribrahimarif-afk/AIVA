import type { PrismaClient } from "@prisma/client";
import type {
  TranscriptionRecord,
  TranscriptionWord,
} from "@/domain/transcription";

export interface CreateTranscriptionInput {
  projectId: string;
  audioSourceId: string;
  provider: string;
  model: string;
  requestedMode: string;
  displayText: string;
  canonicalText: string;
  detectedLanguage?: string | null;
  durationMs: number;
  wordCount: number;
  sourceAudioHash: string;
  configurationHash: string;
}

export interface TranscriptionRepository {
  createTranscriptionWithWords(
    data: CreateTranscriptionInput,
    words: TranscriptionWord[]
  ): Promise<TranscriptionRecord>;
  findById(id: string): Promise<TranscriptionRecord | null>;
  findByConfigurationHash(
    projectId: string,
    configurationHash: string
  ): Promise<TranscriptionRecord | null>;
  findByAudioSourceId(audioSourceId: string): Promise<TranscriptionRecord[]>;
  findByProjectId(projectId: string): Promise<TranscriptionRecord[]>;
}

export function createTranscriptionRepository(db: PrismaClient): TranscriptionRepository {
  return {
    async createTranscriptionWithWords(
      data: CreateTranscriptionInput,
      words: TranscriptionWord[]
    ): Promise<TranscriptionRecord> {
      return db.$transaction(async (tx) => {
        // 1. Create main Transcription record
        const transcription = await tx.transcription.create({
          data: {
            projectId: data.projectId,
            audioSourceId: data.audioSourceId,
            provider: data.provider,
            model: data.model,
            requestedMode: data.requestedMode,
            displayText: data.displayText,
            canonicalText: data.canonicalText,
            detectedLanguage: data.detectedLanguage ?? null,
            durationMs: data.durationMs,
            wordCount: data.wordCount,
            sourceAudioHash: data.sourceAudioHash.toLowerCase(),
            configurationHash: data.configurationHash.toLowerCase(),
          },
        });

        // 2. Insert all Transcription words
        if (words.length > 0) {
          await tx.transcriptionWord.createMany({
            data: words.map((w, index) => ({
              transcriptionId: transcription.id,
              sequence: w.sequence ?? index + 1,
              text: w.text,
              startMs: w.startMs,
              endMs: w.endMs,
              sourceStart: w.sourceStart,
              sourceEnd: w.sourceEnd,
              speaker: w.speaker ?? null,
              confidence: w.confidence ?? null,
              locale: w.locale ?? null,
            })),
          });
        }

        // 3. Update AudioSource activeTranscriptionId
        await tx.audioSource.update({
          where: { id: data.audioSourceId },
          data: { activeTranscriptionId: transcription.id },
        });

        // 4. Query full inserted record with ordered words
        const completeRecord = await tx.transcription.findUniqueOrThrow({
          where: { id: transcription.id },
          include: {
            words: {
              orderBy: { sequence: "asc" },
            },
          },
        });

        return {
          id: completeRecord.id,
          projectId: completeRecord.projectId,
          audioSourceId: completeRecord.audioSourceId,
          provider: completeRecord.provider,
          model: completeRecord.model,
          requestedMode: completeRecord.requestedMode,
          displayText: completeRecord.displayText,
          canonicalText: completeRecord.canonicalText,
          detectedLanguage: completeRecord.detectedLanguage,
          durationMs: completeRecord.durationMs,
          wordCount: completeRecord.wordCount,
          sourceAudioHash: completeRecord.sourceAudioHash,
          configurationHash: completeRecord.configurationHash,
          createdAt: completeRecord.createdAt,
          words: completeRecord.words.map((w) => ({
            id: w.id,
            transcriptionId: w.transcriptionId,
            sequence: w.sequence,
            text: w.text,
            startMs: w.startMs,
            endMs: w.endMs,
            sourceStart: w.sourceStart,
            sourceEnd: w.sourceEnd,
            speaker: w.speaker,
            confidence: w.confidence,
            locale: w.locale,
          })),
        };
      });
    },

    async findById(id: string): Promise<TranscriptionRecord | null> {
      const record = await db.transcription.findUnique({
        where: { id },
        include: {
          words: {
            orderBy: { sequence: "asc" },
          },
        },
      });

      if (!record) return null;

      return {
        id: record.id,
        projectId: record.projectId,
        audioSourceId: record.audioSourceId,
        provider: record.provider,
        model: record.model,
        requestedMode: record.requestedMode,
        displayText: record.displayText,
        canonicalText: record.canonicalText,
        detectedLanguage: record.detectedLanguage,
        durationMs: record.durationMs,
        wordCount: record.wordCount,
        sourceAudioHash: record.sourceAudioHash,
        configurationHash: record.configurationHash,
        createdAt: record.createdAt,
        words: record.words.map((w) => ({
          id: w.id,
          transcriptionId: w.transcriptionId,
          sequence: w.sequence,
          text: w.text,
          startMs: w.startMs,
          endMs: w.endMs,
          sourceStart: w.sourceStart,
          sourceEnd: w.sourceEnd,
          speaker: w.speaker,
          confidence: w.confidence,
          locale: w.locale,
        })),
      };
    },

    async findByConfigurationHash(
      projectId: string,
      configurationHash: string
    ): Promise<TranscriptionRecord | null> {
      const record = await db.transcription.findFirst({
        where: {
          projectId,
          configurationHash: configurationHash.toLowerCase(),
        },
        orderBy: { createdAt: "desc" },
        include: {
          words: {
            orderBy: { sequence: "asc" },
          },
        },
      });

      if (!record) return null;

      return {
        id: record.id,
        projectId: record.projectId,
        audioSourceId: record.audioSourceId,
        provider: record.provider,
        model: record.model,
        requestedMode: record.requestedMode,
        displayText: record.displayText,
        canonicalText: record.canonicalText,
        detectedLanguage: record.detectedLanguage,
        durationMs: record.durationMs,
        wordCount: record.wordCount,
        sourceAudioHash: record.sourceAudioHash,
        configurationHash: record.configurationHash,
        createdAt: record.createdAt,
        words: record.words.map((w) => ({
          id: w.id,
          transcriptionId: w.transcriptionId,
          sequence: w.sequence,
          text: w.text,
          startMs: w.startMs,
          endMs: w.endMs,
          sourceStart: w.sourceStart,
          sourceEnd: w.sourceEnd,
          speaker: w.speaker,
          confidence: w.confidence,
          locale: w.locale,
        })),
      };
    },

    async findByAudioSourceId(audioSourceId: string): Promise<TranscriptionRecord[]> {
      const records = await db.transcription.findMany({
        where: { audioSourceId },
        orderBy: { createdAt: "desc" },
        include: {
          words: {
            orderBy: { sequence: "asc" },
          },
        },
      });

      return records.map((record) => ({
        id: record.id,
        projectId: record.projectId,
        audioSourceId: record.audioSourceId,
        provider: record.provider,
        model: record.model,
        requestedMode: record.requestedMode,
        displayText: record.displayText,
        canonicalText: record.canonicalText,
        detectedLanguage: record.detectedLanguage,
        durationMs: record.durationMs,
        wordCount: record.wordCount,
        sourceAudioHash: record.sourceAudioHash,
        configurationHash: record.configurationHash,
        createdAt: record.createdAt,
        words: record.words.map((w) => ({
          id: w.id,
          transcriptionId: w.transcriptionId,
          sequence: w.sequence,
          text: w.text,
          startMs: w.startMs,
          endMs: w.endMs,
          sourceStart: w.sourceStart,
          sourceEnd: w.sourceEnd,
          speaker: w.speaker,
          confidence: w.confidence,
          locale: w.locale,
        })),
      }));
    },

    async findByProjectId(projectId: string): Promise<TranscriptionRecord[]> {
      const records = await db.transcription.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        include: {
          words: {
            orderBy: { sequence: "asc" },
          },
        },
      });

      return records.map((record) => ({
        id: record.id,
        projectId: record.projectId,
        audioSourceId: record.audioSourceId,
        provider: record.provider,
        model: record.model,
        requestedMode: record.requestedMode,
        displayText: record.displayText,
        canonicalText: record.canonicalText,
        detectedLanguage: record.detectedLanguage,
        durationMs: record.durationMs,
        wordCount: record.wordCount,
        sourceAudioHash: record.sourceAudioHash,
        configurationHash: record.configurationHash,
        createdAt: record.createdAt,
        words: record.words.map((w) => ({
          id: w.id,
          transcriptionId: w.transcriptionId,
          sequence: w.sequence,
          text: w.text,
          startMs: w.startMs,
          endMs: w.endMs,
          sourceStart: w.sourceStart,
          sourceEnd: w.sourceEnd,
          speaker: w.speaker,
          confidence: w.confidence,
          locale: w.locale,
        })),
      }));
    },
  };
}
