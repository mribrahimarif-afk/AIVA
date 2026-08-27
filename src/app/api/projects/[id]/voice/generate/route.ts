import { NextResponse } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { generateVoiceSchema } from "@/domain/voice";
import { ValidationError } from "@/domain/errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

    let body: unknown = {};
    const text = await request.text();
    if (text && text.trim().length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new ValidationError("Invalid JSON request body");
      }
    }

    const parsed = generateVoiceSchema.safeParse(body);
    if (!parsed.success) {
      const sanitizedIssues = parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "voiceName",
        message: issue.message,
      }));
      throw new ValidationError("Invalid voice generation input", {
        issues: sanitizedIssues,
      });
    }

    const track = await services.voice.generateVoice(id, parsed.data);
    return NextResponse.json({ track });
  } catch (error) {
    return toErrorResponse(error);
  }
}
