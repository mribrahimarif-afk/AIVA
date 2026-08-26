/**
 * Contract for future text-to-speech providers (e.g. Azure Speech).
 * No implementation exists in TASK-001.
 */
export interface VoiceProvider {
  readonly id: string;

  synthesize(text: string, options?: Record<string, unknown>): Promise<{ audioFilePath: string }>;
}
