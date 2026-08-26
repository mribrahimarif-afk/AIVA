/**
 * Contract for future AI text/script/planning providers (e.g. Gemini).
 * No implementation exists in TASK-001 — this interface exists so
 * services can be written against it ahead of the actual integration.
 */
export interface AiProvider {
  readonly id: string;

  generateText(prompt: string, options?: Record<string, unknown>): Promise<string>;
}
