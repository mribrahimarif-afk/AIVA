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
  readonly maxOpenRouterAttempts: number;
  totalCallsUsed = 0;
  primaryAttemptsUsed = 0;
  fallbackAttemptsUsed = 0;
  openRouterAttemptsUsed = 0;
  primaryTimeoutEncountered = false;
  fallbackEligibleEncountered = false;
  readonly timedOutRoutes: Set<string> = new Set();
  readonly rateLimitedRoutes: Set<string> = new Set();
  readonly routeAttempts: Map<string, number> = new Map();

  constructor(options?: DirectorExecutionBudgetOptions & { maxOpenRouterAttempts?: number }) {
    this.maxTotalCalls = options?.maxTotalCalls ?? 4;
    this.maxPrimaryAttempts = options?.maxPrimaryAttempts ?? 2;
    this.maxFallbackAttempts = options?.maxFallbackAttempts ?? 2;
    this.maxOpenRouterAttempts = options?.maxOpenRouterAttempts ?? 2;
  }

  canMakePrimaryCall(providerPrimaryLimit?: number): boolean {
    const primaryLimit =
      typeof providerPrimaryLimit === "number"
        ? Math.min(this.maxPrimaryAttempts, providerPrimaryLimit)
        : this.maxPrimaryAttempts;

    return (
      this.totalCallsUsed < this.maxTotalCalls &&
      this.primaryAttemptsUsed < primaryLimit &&
      !this.primaryTimeoutEncountered &&
      !this.rateLimitedRoutes.has("gemini-primary")
    );
  }

  canMakeFallbackCall(providerFallbackLimit?: number): boolean {
    const fallbackLimit =
      typeof providerFallbackLimit === "number"
        ? Math.min(this.maxFallbackAttempts, providerFallbackLimit)
        : this.maxFallbackAttempts;

    return (
      this.totalCallsUsed < this.maxTotalCalls &&
      this.fallbackAttemptsUsed < fallbackLimit &&
      !this.timedOutRoutes.has("gemini-fallback") &&
      !this.rateLimitedRoutes.has("gemini-fallback")
    );
  }

  canMakeRouteCall(routeId: string, maxRouteAttempts = 2): boolean {
    const attempts = this.routeAttempts.get(routeId) ?? 0;
    return (
      this.totalCallsUsed < this.maxTotalCalls &&
      attempts < maxRouteAttempts &&
      !this.timedOutRoutes.has(routeId) &&
      !this.rateLimitedRoutes.has(routeId)
    );
  }

  /**
   * Starvation guard: allows same-route retry only if remaining calls exceed
   * the number of untried downstream routes.
   */
  canRetryOnRoute(routeId: string, untriedDownstreamCount: number, maxRouteAttempts = 2): boolean {
    if (!this.canMakeRouteCall(routeId, maxRouteAttempts)) {
      return false;
    }
    const remainingCalls = this.maxTotalCalls - this.totalCallsUsed;
    return remainingCalls > untriedDownstreamCount;
  }

  hasRemainingBudget(): boolean {
    return this.totalCallsUsed < this.maxTotalCalls;
  }

  recordPrimaryCall(): void {
    this.totalCallsUsed++;
    this.primaryAttemptsUsed++;
    this.routeAttempts.set("gemini-primary", (this.routeAttempts.get("gemini-primary") ?? 0) + 1);
  }

  recordFallbackCall(): void {
    this.totalCallsUsed++;
    this.fallbackAttemptsUsed++;
    this.routeAttempts.set("gemini-fallback", (this.routeAttempts.get("gemini-fallback") ?? 0) + 1);
  }

  recordRouteCall(routeId: string): void {
    this.totalCallsUsed++;
    const current = this.routeAttempts.get(routeId) ?? 0;
    this.routeAttempts.set(routeId, current + 1);

    if (routeId === "gemini-primary") {
      this.primaryAttemptsUsed++;
    } else if (routeId === "gemini-fallback") {
      this.fallbackAttemptsUsed++;
    } else if (routeId === "openrouter" || routeId.startsWith("openrouter")) {
      this.openRouterAttemptsUsed++;
    }
  }

  recordPrimaryTimeout(): void {
    this.primaryTimeoutEncountered = true;
    this.fallbackEligibleEncountered = true;
    this.timedOutRoutes.add("gemini-primary");
  }

  recordRouteTimeout(routeId: string): void {
    this.timedOutRoutes.add(routeId);
    this.fallbackEligibleEncountered = true;
    if (routeId === "gemini-primary") {
      this.primaryTimeoutEncountered = true;
    }
  }

  recordRouteRateLimited(routeId: string): void {
    this.rateLimitedRoutes.add(routeId);
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

