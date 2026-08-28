import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { ValidationError } from "@/domain/errors";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { id } = await context.params;

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throw new ValidationError("Content-Type must be 'multipart/form-data'");
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string" || typeof (file as Blob).arrayBuffer !== "function") {
      throw new ValidationError("Multipart form-data must contain a valid audio 'file' field");
    }

    const blob = file as File;
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    const declaredMimeType = blob.type || "audio/wav";
    const originalFilename = blob.name || "uploaded-audio";

    const audioSource = await services.transcription.uploadAudioSource(
      id,
      audioBuffer,
      declaredMimeType,
      originalFilename
    );

    return NextResponse.json({ audioSource }, { status: 201 });
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
    const audioSources = await services.transcription.getAudioSources(id);
    return NextResponse.json({ audioSources });
  } catch (error: unknown) {
    return toErrorResponse(error);
  }
}
