import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { useWithDirectorSchema } from "@/domain/transcription";

interface RouteContext {
  params: Promise<{ id: string; transcriptionId: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id, transcriptionId } = await context.params;

    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty JSON body is valid for default options
    }

    const input = useWithDirectorSchema.parse(body);
    const plan = await services.transcription.useWithDirector(id, transcriptionId, input);

    return NextResponse.json({ plan }, { status: 200 });
  } catch (error: unknown) {
    return toErrorResponse(error);
  }
}
