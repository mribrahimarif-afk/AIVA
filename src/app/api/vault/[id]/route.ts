import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const asset = await services.vault.getAsset(id);
    return NextResponse.json({ asset });
  } catch (error) {
    return toErrorResponse(error);
  }
}
