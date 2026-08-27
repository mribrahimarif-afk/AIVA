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
      const rawRange = rangeHeader.trim();
      const match = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/i.exec(rawRange);

      if (!match || rawRange === "bytes=-") {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${sizeBytes}`,
          },
        });
      }

      let start: number;
      let end: number;

      if (match[3] !== undefined) {
        // Suffix byte range specifier (bytes=-N -> last N bytes)
        const suffixLength = parseInt(match[3], 10);
        if (isNaN(suffixLength) || suffixLength <= 0) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${sizeBytes}`,
            },
          });
        }
        start = Math.max(0, sizeBytes - suffixLength);
        end = sizeBytes - 1;
      } else {
        // Standard range specifier (bytes=start-end or bytes=start-)
        const startRaw = match[1];
        const endRaw = match[2];

        start = startRaw ? parseInt(startRaw, 10) : 0;
        end = endRaw ? parseInt(endRaw, 10) : sizeBytes - 1;
      }

      if (
        isNaN(start) ||
        isNaN(end) ||
        start < 0 ||
        start >= sizeBytes ||
        end < start
      ) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${sizeBytes}`,
          },
        });
      }

      // Clamp end byte index to file boundary
      if (end >= sizeBytes) {
        end = sizeBytes - 1;
      }

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
