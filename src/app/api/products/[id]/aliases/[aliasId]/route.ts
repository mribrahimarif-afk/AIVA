import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; aliasId: string }> }
): Promise<NextResponse> {
  try {
    const { aliasId } = await context.params;
    await services.product.removeAlias(aliasId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
