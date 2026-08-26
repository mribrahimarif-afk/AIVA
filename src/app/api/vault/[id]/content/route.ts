import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";
import { repositories } from "@/services/container";
import { storageService } from "@/storage/storage.service";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { NotFoundError } from "@/domain/errors";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const asset = await repositories.asset.findById(id);
    if (!asset || !asset.blobId) {
      throw new NotFoundError(`Vault asset with id '${id}' not found`, { assetId: id });
    }

    const blob = await repositories.contentBlob.findById(asset.blobId);
    if (!blob || !blob.storagePath) {
      throw new NotFoundError(`Backing binary content for asset '${id}' not found`, { assetId: id });
    }

    const { sizeBytes, isFile } = await storageService.getBlobStat(blob.storagePath);
    if (!isFile) {
      throw new NotFoundError(`Backing storage path for asset '${id}' is not a regular file`, { assetId: id });
    }

    const contentType = asset.mimeType || blob.mimeType || "application/octet-stream";
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
      if (!match) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${sizeBytes}`,
          },
        });
      }

      const startRaw = match[1];
      const endRaw = match[2];

      const startParsed = startRaw ? parseInt(startRaw, 10) : 0;
      const endParsed = endRaw ? parseInt(endRaw, 10) : sizeBytes - 1;

      if (isNaN(startParsed) || startParsed < 0 || startParsed >= sizeBytes || isNaN(endParsed) || endParsed < startParsed) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${sizeBytes}`,
          },
        });
      }

      const end = endParsed >= sizeBytes ? sizeBytes - 1 : endParsed;
      const start = startParsed;

      const chunkSize = end - start + 1;
      const nodeStream = storageService.createBlobReadStream(blob.storagePath, { start, end });
      const webStream = Readable.toWeb(nodeStream);

      return new NextResponse(webStream as unknown as BodyInit, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${sizeBytes}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
        },
      });
    }

    // Full File Streaming (HTTP 200)
    const nodeStream = storageService.createBlobReadStream(blob.storagePath);
    const webStream = Readable.toWeb(nodeStream);

    return new NextResponse(webStream as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(sizeBytes),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
