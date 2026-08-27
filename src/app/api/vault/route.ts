import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import type { VaultRole } from "@/domain/asset";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const role = (searchParams.get("role") as VaultRole) || undefined;
    const brandId = searchParams.get("brandId") || undefined;
    const productId = searchParams.get("productId") || undefined;

    const assets = await services.vault.listAssets({ role, brandId, productId });
    return NextResponse.json({ assets });
  } catch (error) {
    return toErrorResponse(error);
  }
}
