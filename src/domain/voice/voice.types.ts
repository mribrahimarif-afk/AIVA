export const SUPPORTED_VOICES = [
  "ur-PK-AsadNeural",
  "ur-PK-UzmaNeural",
  "en-US-AndrewMultilingualNeural",
  "en-US-AvaMultilingualNeural",
] as const;

export type SupportedVoice = (typeof SUPPORTED_VOICES)[number];

export interface VoiceProfile {
  name: SupportedVoice;
  displayName: string;
  language: string;
  locale: string;
  gender: "Male" | "Female";
  description: string;
  isDefault?: boolean;
}

export const VOICE_PROFILES: Record<SupportedVoice, VoiceProfile> = {
  "ur-PK-AsadNeural": {
    name: "ur-PK-AsadNeural",
    displayName: "Asad",
    language: "Urdu (Pakistan)",
    locale: "ur-PK",
    gender: "Male",
    description: "Natural Urdu male narration voice",
    isDefault: true,
  },
  "ur-PK-UzmaNeural": {
    name: "ur-PK-UzmaNeural",
    displayName: "Uzma",
    language: "Urdu (Pakistan)",
    locale: "ur-PK",
    gender: "Female",
    description: "Natural Urdu female narration voice",
  },
  "en-US-AndrewMultilingualNeural": {
    name: "en-US-AndrewMultilingualNeural",
    displayName: "Andrew (Multilingual)",
    language: "English / Multilingual",
    locale: "en-US",
    gender: "Male",
    description: "Versatile multilingual male voice",
  },
  "en-US-AvaMultilingualNeural": {
    name: "en-US-AvaMultilingualNeural",
    displayName: "Ava (Multilingual)",
    language: "English / Multilingual",
    locale: "en-US",
    gender: "Female",
    description: "Versatile multilingual female voice",
  },
};

export const DEFAULT_VOICE: SupportedVoice = "ur-PK-AsadNeural";
export const VOICE_OUTPUT_FORMAT = "Riff24Khz16BitMonoPcm";

export type VoiceTrackState = "CURRENT" | "STALE";

export interface RawVoiceBoundary {
  text: string;
  textOffset: number; // JavaScript string character offset in source text
  wordLength: number; // Character length of the word in source text
  audioOffsetTicks: number; // Audio start in 100ns ticks
  durationTicks: number; // Audio duration in 100ns ticks
  boundaryType: string;
}

export interface VoiceSynthesisResult {
  audioData: Buffer;
  audioDurationTicks: number;
  voiceName: string;
  outputFormat: string;
  boundaries: RawVoiceBoundary[];
}

export interface VoiceBoundaryDto {
  id?: string;
  order: number;
  sourceStart: number;
  sourceEnd: number;
  audioStartMs: number;
  audioDurationMs: number;
  text: string; // Reconstructed locally from originalScript
}

export interface VoiceTrackDto {
  id: string;
  projectId: string;
  directorPlanId: string;
  sourceScriptHash: string;
  provider: string;
  voiceName: string;
  locale: string;
  outputFormat: string;
  audioSha256: string;
  audioByteCount: number;
  audioStorageRef: string;
  durationMs: number;
  generatedAt: string;
  state: VoiceTrackState;
  boundaryCount: number;
  audioUrl: string;
}

export interface VoiceTrackWithBoundariesDto extends VoiceTrackDto {
  boundaries: VoiceBoundaryDto[];
}

export interface GenerateVoiceInput {
  voiceName?: SupportedVoice;
  force?: boolean;
}

export interface VoiceTrackAggregate {
  id: string;
  projectId: string;
  directorPlanId: string;
  sourceScriptHash: string;
  provider: string;
  voiceName: string;
  locale: string;
  outputFormat: string;
  audioSha256: string;
  audioByteCount: number;
  audioStorageRef: string;
  durationMs: number;
  generatedAt: Date;
  boundaries: Array<{
    id: string;
    voiceTrackId: string;
    order: number;
    sourceStart: number;
    sourceEnd: number;
    audioStartMs: number;
    audioDurationMs: number;
  }>;
}
