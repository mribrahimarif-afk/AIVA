/**
 * Contract for future *local* video processing operations (e.g. an
 * FFmpeg-driven trim/concat/format-conversion step during rendering).
 *
 * AIVA does not call any AI video-generation API and never will: clips
 * from external tools (e.g. Google Flow/Veo) are produced outside AIVA
 * and manually uploaded through AIVA Intake, not fetched via a provider
 * integration. There is deliberately no "generate a clip from a prompt"
 * method here — this interface exists only for operations performed on
 * video files AIVA already has locally. No implementation exists in
 * TASK-001.
 */
export interface VideoProcessingProvider {
  readonly id: string;

  processClip(inputPath: string, options?: Record<string, unknown>): Promise<{ outputPath: string }>;
}
