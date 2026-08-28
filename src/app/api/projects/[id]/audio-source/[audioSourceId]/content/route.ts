import { Readable } from "node:stream";
import { services } from "@/services/container";
import { audioSourceStorageService } from "@/storage/audio-source-storage.service";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { NotFoundError } from "@/domain/errors";

interface RouteParams {
  params: Promise<{ id: string; audioSourceId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { id, audioSourceId } = await params;
    const audioSource = await services.transcription.getAudioSource(audioSourceId);

    if (!audioSource || audioSource.projectId !== id) {
      throw new NotFoundError("AudioSource not found for this project", { id, audioSourceId });
    }

    const fileExists = await audioSourceStorageService.audioSourceExists(audioSource.storageRef);
    if (!fileExists) {
      throw new NotFoundError("Audio source file not found in storage", {
        storageRef: audioSource.storageRef,
      });
    }

    const nodeStream = audioSourceStorageService.createAudioSourceReadStream(audioSource.storageRef);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": audioSource.mimeType || "audio/wav",
        "Content-Length": audioSource.sizeBytes.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
