import { NextResponse } from "next/server";
import { services, voiceProvider } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { VOICE_PROFILES } from "@/domain/voice";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const track = await services.voice.getVoiceTrack(id);

    return NextResponse.json({
      track,
      isConfigured: voiceProvider.isConfigured(),
      defaultVoice: voiceProvider.defaultVoice,
      supportedVoices: Object.values(VOICE_PROFILES),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
