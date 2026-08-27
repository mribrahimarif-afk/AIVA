import type { ScriptUnit, RawDirectorOutput } from "@/domain/director";

export interface BrandContextForDirector {
  name: string;
}

export interface ProductContextForDirector {
  name: string;
  description?: string | null;
  aliases: string[];
}

export interface DirectorExecutionBudgetOptions {
  maxTotalCalls?: number;
  maxPrimaryAttempts?: number;
  maxFallbackAttempts?: number;
}

/**
 * Request-scoped transport budget tracking and bounding Gemini API calls
 * across initial analysis, retries, fallback, and semantic repair.
 */
export class DirectorExecutionBudget {
  readonly maxTotalCalls: number;
  readonly maxPrimaryAttempts: number;
  readonly maxFallbackAttempts: number;
  totalCallsUsed = 0;
  primaryAttemptsUsed = 0;
  fallbackAttemptsUsed = 0;
  primaryTimeoutEncountered = false;
  fallbackEligibleEncountered = false;

  constructor(options?: DirectorExecutionBudgetOptions) {
    this.maxTotalCalls = options?.maxTotalCalls ?? 4;
    this.maxPrimaryAttempts = options?.maxPrimaryAttempts ?? 2;
    this.maxFallbackAttempts = options?.maxFallbackAttempts ?? 2;
  }

  canMakePrimaryCall(providerPrimaryLimit?: number): boolean {
    const primaryLimit =
      typeof providerPrimaryLimit === "number"
        ? Math.min(this.maxPrimaryAttempts, providerPrimaryLimit)
        : this.maxPrimaryAttempts;

    return (
      this.totalCallsUsed < this.maxTotalCalls &&
      this.primaryAttemptsUsed < primaryLimit &&
      !this.primaryTimeoutEncountered
    );
  }

  canMakeFallbackCall(providerFallbackLimit?: number): boolean {
    const fallbackLimit =
      typeof providerFallbackLimit === "number"
        ? Math.min(this.maxFallbackAttempts, providerFallbackLimit)
        : this.maxFallbackAttempts;

    return (
      this.totalCallsUsed < this.maxTotalCalls &&
      this.fallbackAttemptsUsed < fallbackLimit
    );
  }

  hasRemainingBudget(): boolean {
    return this.totalCallsUsed < this.maxTotalCalls;
  }

  recordPrimaryCall(): void {
    this.totalCallsUsed++;
    this.primaryAttemptsUsed++;
  }

  recordFallbackCall(): void {
    this.totalCallsUsed++;
    this.fallbackAttemptsUsed++;
  }

  recordPrimaryTimeout(): void {
    this.primaryTimeoutEncountered = true;
    this.fallbackEligibleEncountered = true;
  }

  recordFallbackEligible(): void {
    this.fallbackEligibleEncountered = true;
  }
}

export function createDirectorExecutionBudget(
  options?: DirectorExecutionBudgetOptions
): DirectorExecutionBudget {
  return new DirectorExecutionBudget(options);
}

export interface DirectorPromptInput {
  scriptUnits: ScriptUnit[];
  brandContext?: BrandContextForDirector;
  productContext?: ProductContextForDirector;
  budget?: DirectorExecutionBudget;
}

export interface DirectorRepairInput extends DirectorPromptInput {
  rawOutput: unknown;
  validationErrors: string[];
  budget?: DirectorExecutionBudget;
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

