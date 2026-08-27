import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const brand = await services.brand.getBrand(id);
    const products = await services.product.listProductsByBrand(id);
    const assets = await services.vault.listAssets({ brandId: id });

    return NextResponse.json({ brand, products, assets });
  } catch (error) {
    return toErrorResponse(error);
  }
}
