import type { ScriptUnit, RawDirectorOutput } from "@/domain/director";

export interface BrandContextForDirector {
  name: string;
}

export interface ProductContextForDirector {
  name: string;
  description?: string | null;
  aliases: string[];
}

export interface DirectorPromptInput {
  scriptUnits: ScriptUnit[];
  brandContext?: BrandContextForDirector;
  productContext?: ProductContextForDirector;
}

export interface DirectorRepairInput extends DirectorPromptInput {
  rawOutput: unknown;
  validationErrors: string[];
}

/**
 * AI Provider interface for Director script intelligence and scene planning.
 */
export interface DirectorAiProvider {
  readonly id: string;
  readonly modelName: string;
  readonly fallbackModelName?: string;
  isConfigured(): boolean;
  analyze(input: DirectorPromptInput): Promise<RawDirectorOutput>;
  repair(input: DirectorRepairInput): Promise<RawDirectorOutput>;
}

/**
 * Legacy/base AI text provider contract.
 */
export interface AiProvider {
  readonly id: string;
  generateText(prompt: string, options?: Record<string, unknown>): Promise<string>;
}
