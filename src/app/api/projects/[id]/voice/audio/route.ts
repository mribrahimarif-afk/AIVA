import { Readable } from "node:stream";
import { services } from "@/services/container";
import { voiceStorageService } from "@/storage/voice-storage.service";
import { toErrorResponse } from "@/infrastructure/http/error-response";
import { NotFoundError } from "@/domain/errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { id } = await params;
    const track = await services.voice.getVoiceTrack(id);

    if (!track) {
      throw new NotFoundError("VoiceTrack for project not found", { id });
    }

    const stat = await voiceStorageService.getAudioStat(track.audioStorageRef);
    const nodeStream = voiceStorageService.createAudioReadStream(track.audioStorageRef);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": stat.sizeBytes.toString(),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
