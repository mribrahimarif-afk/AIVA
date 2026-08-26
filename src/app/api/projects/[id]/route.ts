import { NextResponse } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const project = await services.project.getProject(id);
    return NextResponse.json({ project });
  } catch (error) {
    return toErrorResponse(error);
  }
}
