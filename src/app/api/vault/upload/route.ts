import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import busboy from "busboy";
import { services } from "@/services/container";
import { storageService, type StagedUploadResult } from "@/storage/storage.service";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import type { VaultRole } from "@/domain/asset";
import { ValidationError, StorageError } from "@/domain/errors";

interface UploadFileInfo {
  filename: string;
  mimeType: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let stagedInfo: StagedUploadResult | null = null;
  let ownershipTransferredToService = false;

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
    let fileCount = 0;
    let streamError: Error | null = null;

    const bb = busboy({ headers: { "content-type": contentType } });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (fieldname, fileStream, info) => {
      fileCount++;
      if (fileCount > 1) {
        fileStream.resume(); // drain extra file streams safely
        if (!streamError) {
          streamError = new ValidationError("Only a single file field named 'file' is accepted");
        }
        return;
      }

      if (fieldname !== "file") {
        fileStream.resume(); // drain unexpected field name file stream
        if (!streamError) {
          streamError = new ValidationError(
            `Unexpected file field name '${fieldname}'. Allowed field name is 'file'`
          );
        }
        return;
      }

      const { filename, mimeType } = info;
      if (!filename) {
        fileStream.resume();
        if (!streamError) {
          streamError = new ValidationError("Uploaded file has no filename");
        }
        return;
      }

      uploadedFileInfo = { filename, mimeType: mimeType || "application/octet-stream" };

      // Stream file directly to temporary file on disk with backpressure & SHA-256
      stagedInfoPromise = storageService.stageStream(fileStream, filename).catch((err) => {
        if (!streamError) streamError = err;
        fileStream.resume();
        throw err;
      });
    });

    const nodeStream = Readable.fromWeb(request.body as unknown as Parameters<typeof Readable.fromWeb>[0]);

    await new Promise<void>((resolve, reject) => {
      bb.on("finish", resolve);
      bb.on("error", (err) => reject(err));
      nodeStream.on("error", (err) => reject(err));
      nodeStream.pipe(bb);
    });

    if (streamError) {
      throw streamError;
    }

    if (!stagedInfoPromise || !uploadedFileInfo) {
      throw new ValidationError("No valid file uploaded in multipart form data");
    }

    stagedInfo = await stagedInfoPromise;
    const info: UploadFileInfo = uploadedFileInfo;

    const vaultRole = fields["vaultRole"] as VaultRole;
    if (!vaultRole) {
      throw new ValidationError("vaultRole is required");
    }

    const brandId = fields["brandId"] || null;
    const productId = fields["productId"] || null;
    const title = fields["title"] || info.filename;

    // Explicit Ownership Transfer to VaultService
    ownershipTransferredToService = true;
    const result = await services.vault.uploadStaged({
      stagedInfo,
      originalFilename: info.filename,
      mimeType: info.mimeType,
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
    // If route owned the staged temp file and failure occurred BEFORE ownership transfer:
    if (stagedInfo && !ownershipTransferredToService) {
      const activeStaged: StagedUploadResult = stagedInfo;
      let cleanupFailed = false;
      let cleanupErrMessage = "";
      try {
        await storageService.removeTempFile(activeStaged.tempPath);
      } catch (rmErr) {
        cleanupFailed = true;
        cleanupErrMessage = rmErr instanceof Error ? rmErr.message : String(rmErr);
      }

      if (cleanupFailed) {
        return toErrorResponse(
          new StorageError(
            `Request failed prior to service transfer, and temp file cleanup also failed; file is orphaned at '${activeStaged.tempPath}'`,
            {
              tempPath: activeStaged.tempPath,
              partialUploadOrphaned: true,
              primaryCause: error instanceof Error ? error.message : String(error),
              cleanupCause: cleanupErrMessage,
            }
          )
        );
      }
    }

    return toErrorResponse(error);
  }
}
