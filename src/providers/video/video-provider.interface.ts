/**
 * Contract for future AI video generation providers (e.g. Google Flow).
 * No implementation exists in TASK-001.
 */
export interface VideoProvider {
  readonly id: string;

  generateClip(prompt: string, options?: Record<string, unknown>): Promise<{ filePath: string }>;
}
