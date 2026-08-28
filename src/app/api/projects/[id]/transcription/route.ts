import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { transcribeRequestSchema } from "@/domain/transcription";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const input = transcribeRequestSchema.parse(body);

    const transcription = await services.transcription.transcribeAudio(id, input);

    return NextResponse.json({ transcription }, { status: 200 });
  } catch (error: unknown) {
    return toErrorResponse(error);
  }
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    const [activeTranscription, transcriptions] = await Promise.all([
      services.transcription.getActiveTranscription(id),
      services.transcription.getTranscriptions(id),
    ]);

    return NextResponse.json({
      activeTranscription,
      transcriptions,
    });
  } catch (error: unknown) {
    return toErrorResponse(error);
  }
}
