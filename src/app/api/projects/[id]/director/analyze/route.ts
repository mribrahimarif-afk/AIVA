import { NextResponse } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { analyzeScriptInputSchema } from "@/domain/director";
import { ValidationError } from "@/domain/errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Invalid JSON request body");
    }

    const parsed = analyzeScriptInputSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ValidationError(issue?.message ?? "Invalid script analysis input", {
        issues: parsed.error.issues,
      });
    }

    const plan = await services.director.analyzeAndPlan(id, parsed.data);
    return NextResponse.json({ plan });
  } catch (error) {
    return toErrorResponse(error);
  }
}
