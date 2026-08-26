import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import busboy from "busboy";
import { services } from "@/services/container";
import { storageService, type StagedUploadResult } from "@/storage/storage.service";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import type { VaultRole } from "@/domain/asset";
import { ValidationError } from "@/domain/errors";

interface UploadFileInfo {
  filename: string;
  mimeType: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const contentType = request.headers.get("content-type");
    if (!contentType || !contentType.toLowerCase().includes("multipart/form-data")) {
      throw new ValidationError("Content-Type must be 'multipart/form-data'");
    }

    if (!request.body) {
      throw new ValidationError("HTTP request body stream is empty");
    }

    const fields: Record<string, string> = {};
    let uploadedFileInfo: UploadFileInfo | null = null;
    let stagedInfoPromise: Promise<StagedUploadResult> | null = null;
    let streamError: Error | null = null;

    const bb = busboy({ headers: { "content-type": contentType } });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (_fieldname, fileStream, info) => {
      const { filename, mimeType } = info;
      if (!filename) {
        fileStream.resume(); // discard unnamed file streams
        return;
      }

      uploadedFileInfo = { filename, mimeType: mimeType || "application/octet-stream" };

      // Pipe fileStream directly to temporary file on disk as chunks arrive over HTTP
      stagedInfoPromise = storageService.stageStream(fileStream, filename).catch((err) => {
        streamError = err;
        fileStream.resume(); // drain stream on error
        throw err;
      });
    });

    const nodeStream = Readable.fromWeb(request.body as unknown as Parameters<typeof Readable.fromWeb>[0]);

    await new Promise<void>((resolve, reject) => {
      bb.on("finish", resolve);
      bb.on("error", reject);
      nodeStream.on("error", reject);
      nodeStream.pipe(bb);
    });

    if (streamError) {
      throw streamError;
    }

    if (!stagedInfoPromise || !uploadedFileInfo) {
      throw new ValidationError("No valid file uploaded in multipart form data");
    }

    const activeFileInfo: UploadFileInfo = uploadedFileInfo;
    const stagedInfo = await stagedInfoPromise;
    const vaultRole = (fields["vaultRole"] as VaultRole) || undefined;
    const brandId = fields["brandId"] || null;
    const productId = fields["productId"] || null;
    const title = fields["title"] || activeFileInfo.filename;

    const result = await services.vault.uploadStaged({
      stagedInfo,
      originalFilename: activeFileInfo.filename,
      mimeType: activeFileInfo.mimeType,
      vaultRole: vaultRole!,
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
