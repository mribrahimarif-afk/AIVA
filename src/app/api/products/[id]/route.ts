import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import type { UpdateProductInput } from "@/domain/product";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const product = await services.product.getProduct(id);
    return NextResponse.json({ product });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as UpdateProductInput;
    const product = await services.product.updateProduct(id, body);
    return NextResponse.json({ product });
  } catch (error) {
    return toErrorResponse(error);
  }
}
