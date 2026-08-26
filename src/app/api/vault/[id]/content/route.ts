import fs from "node:fs/promises";
import createReadStream from "node:fs";
import { NextResponse, type NextRequest } from "next/server";
import { repositories } from "@/services/container";
import { resolveStoragePath } from "@/storage/paths";
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

    const absolutePath = resolveStoragePath(blob.storagePath);
    const stat = await fs.stat(absolutePath);

    const contentType = asset.mimeType || blob.mimeType || "application/octet-stream";

    // Handle Range Header for Video/Audio streaming
    const rangeHeader = request.headers.get("range");
    if (rangeHeader && stat.isFile()) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0] || "0", 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      const fileStream = createReadStream.createReadStream(absolutePath, { start, end });
      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on("data", (chunk: string | Buffer) => controller.enqueue(chunk));
          fileStream.on("end", () => controller.close());
          fileStream.on("error", (err) => controller.error(err));
        },
      });

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
        },
      });
    }

    const fileBuffer = await fs.readFile(absolutePath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
