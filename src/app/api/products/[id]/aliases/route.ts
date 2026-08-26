import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: productId } = await context.params;
    const body = (await request.json()) as { alias: string };
    const alias = await services.product.addAlias({
      productId,
      alias: body.alias,
    });
    return NextResponse.json({ alias }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
