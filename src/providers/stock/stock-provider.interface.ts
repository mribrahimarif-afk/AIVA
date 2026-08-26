/**
 * Contract for future stock media providers (e.g. Pexels, Pixabay).
 * No implementation exists in TASK-001.
 */
export interface StockMediaResult {
  id: string;
  url: string;
  previewUrl: string;
  attribution?: string;
}

export interface StockProvider {
  readonly id: string;

  search(query: string, options?: Record<string, unknown>): Promise<StockMediaResult[]>;
}
