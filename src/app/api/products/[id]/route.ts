import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const product = await services.product.getProduct(id);
    const assets = await services.vault.listAssets({ productId: id });
    return NextResponse.json({ product, assets });
  } catch (error) {
    return toErrorResponse(error);
  }
}
