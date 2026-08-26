import { NextResponse, type NextRequest } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import type { VaultRole } from "@/domain/asset";
import { ValidationError } from "@/domain/errors";
import { getEnv } from "@/infrastructure/config/env";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const env = getEnv();
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > env.AIVA_MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `Upload size exceeds maximum allowed limit of ${env.AIVA_MAX_UPLOAD_BYTES} bytes`
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      throw new ValidationError("No valid file uploaded in field 'file'", {
        field: "file",
      });
    }

    if (file.size > env.AIVA_MAX_UPLOAD_BYTES) {
      throw new ValidationError(
        `Uploaded file size (${file.size} bytes) exceeds maximum limit (${env.AIVA_MAX_UPLOAD_BYTES} bytes)`
      );
    }

    const vaultRole = formData.get("vaultRole") as VaultRole;
    if (!vaultRole) {
      throw new ValidationError("Field 'vaultRole' is required", {
        field: "vaultRole",
      });
    }

    const brandId = (formData.get("brandId") as string) || null;
    const productId = (formData.get("productId") as string) || null;
    const title = (formData.get("title") as string) || file.name;

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const result = await services.vault.uploadAsset({
      fileBuffer,
      originalFilename: file.name,
      mimeType: file.type || "application/octet-stream",
      vaultRole,
      brandId,
      productId,
      title,
    });

    return NextResponse.json(
      {
        asset: result.asset,
        isDuplicate: result.isDuplicate,
      },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
