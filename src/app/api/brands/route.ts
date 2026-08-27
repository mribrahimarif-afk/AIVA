import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

export async function GET(): Promise<NextResponse> {
  try {
    const brands = await services.brand.listBrands();
    return NextResponse.json({ brands });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { name: string; slug?: string };
    const brand = await services.brand.createBrand({
      name: body.name,
      slug: body.slug,
    });
    return NextResponse.json({ brand }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
