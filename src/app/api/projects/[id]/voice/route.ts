import { NextResponse } from "next/server";
import { services, azureVoiceProvider, elevenLabsVoiceProvider } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { VOICE_PROFILES } from "@/domain/voice";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const track = await services.voice.getVoiceTrack(id);

    const azureVoices = Object.values(VOICE_PROFILES);
    const elevenLabsVoices = await elevenLabsVoiceProvider.listVoices();

    return NextResponse.json({
      track,
      isConfigured: azureVoiceProvider.isConfigured(),
      defaultVoice: azureVoiceProvider.defaultVoice,
      supportedVoices: azureVoices,
      providers: {
        azure: {
          id: "AZURE",
          name: "Azure Speech",
          isConfigured: azureVoiceProvider.isConfigured(),
          defaultVoice: azureVoiceProvider.defaultVoice,
          defaultModel: azureVoiceProvider.defaultModel,
          voices: azureVoices,
        },
        elevenlabs: {
          id: "ELEVENLABS",
          name: "ElevenLabs",
          isConfigured: elevenLabsVoiceProvider.isConfigured(),
          defaultVoice: elevenLabsVoiceProvider.defaultVoice,
          defaultModel: elevenLabsVoiceProvider.defaultModel,
          voices: elevenLabsVoices,
        },
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
