import type {
  TranscriptionMode,
  TranscriptionProviderId,
  TranscriptionResult,
} from "@/domain/transcription";

export interface TranscriptionInput {
  audioBuffer: Buffer;
  mimeType: string;
  sourceFilePath?: string;
  durationMs?: number;
  projectId: string;
  audioSourceId: string;
  requestedMode: TranscriptionMode;
}

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId;
  readonly modelName: string;
  isConfigured(): boolean;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
