/**
 * AIVA Studio V4 - Transcription Domain Types (TASK-004B)
 */

export const TRANSCRIPTION_MODES = ["AUTO", "GEMINI", "AZURE", "ELEVENLABS"] as const;
export type TranscriptionMode = (typeof TRANSCRIPTION_MODES)[number];

export const TRANSCRIPTION_PROVIDERS = [
  "gemini-transcribe",
  "azure-speech-stt",
  "elevenlabs-scribe",
] as const;
export type TranscriptionProviderId = (typeof TRANSCRIPTION_PROVIDERS)[number];

export const DIRECTOR_SOURCE_TYPES = ["SCRIPT", "AUDIO_TRANSCRIPT"] as const;
export type DirectorSourceType = (typeof DIRECTOR_SOURCE_TYPES)[number];

export interface TranscriptionWord {
  id?: string;
  transcriptionId?: string;
  sequence: number;
  text: string;
  startMs: number;
  endMs: number;
  sourceStart: number;
  sourceEnd: number;
  speaker?: string | null;
  confidence?: number | null;
  locale?: string | null;
}

export interface RawTranscriptionWord {
  text: string;
  startMs: number;
  endMs: number;
  speaker?: string | null;
  confidence?: number | null;
  locale?: string | null;
}

export interface TranscriptionResult {
  provider: TranscriptionProviderId;
  model: string;
  requestedMode: TranscriptionMode;
  displayText: string;
  canonicalText: string;
  detectedLanguage?: string | null;
  durationMs: number;
  wordCount: number;
  words: TranscriptionWord[];
  noSpeech?: boolean;
}

export interface AudioSourceInfo {
  id: string;
  projectId: string;
  storageRef: string;
  sourceHash: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  originalDisplayName?: string | null;
  activeTranscriptionId?: string | null;
  createdAt: Date;
}

export interface TranscriptionRecord {
  id: string;
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
  createdAt: Date;
  words?: TranscriptionWord[];
}

export interface AudioUploadValidationResult {
  valid: boolean;
  mimeType: string;
  extension: string;
  durationMs?: number;
  error?: string;
}
