import { VoiceSynthesisResult, VoiceProfile } from "@/domain/voice";

export interface VoiceSynthesisOptions {
  text: string;
  voiceName?: string;
  modelId?: string;
}

export interface VoiceProvider {
  readonly id: string;
  readonly defaultVoice: string;
  readonly defaultModel: string;
  isConfigured(): boolean;
  synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesisResult>;
  listVoices?(): Promise<VoiceProfile[]>;
}
