import { VoiceSynthesisResult, SupportedVoice } from "@/domain/voice";

export interface VoiceSynthesisOptions {
  text: string;
  voiceName?: SupportedVoice;
}

export interface VoiceProvider {
  readonly id: string;
  readonly defaultVoice: SupportedVoice;
  isConfigured(): boolean;
  synthesize(options: VoiceSynthesisOptions): Promise<VoiceSynthesisResult>;
}
