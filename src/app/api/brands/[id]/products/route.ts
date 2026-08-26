import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const products = await services.product.listProductsByBrand(id);
    return NextResponse.json({ products });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id: brandId } = await context.params;
    const body = (await request.json()) as { name: string; slug?: string; description?: string };
    const product = await services.product.createProduct({
      brandId,
      name: body.name,
      slug: body.slug,
      description: body.description,
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
