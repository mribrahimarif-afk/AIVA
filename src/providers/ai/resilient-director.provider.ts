import { ProviderError } from "@/domain/errors";
import type { RawDirectorOutput } from "@/domain/director/director.types";
import type {
  DirectorAiProvider,
  DirectorPromptInput,
  DirectorRepairInput,
} from "./ai-provider.interface";
import { DirectorExecutionBudget } from "./ai-provider.interface";
import { GeminiDirectorProvider } from "./gemini-director.provider";
import { OpenRouterDirectorProvider } from "./openrouter-director.provider";
import type { Logger } from "@/infrastructure/logging/logger";

export interface ResilientDirectorProviderOptions {
  geminiProvider: GeminiDirectorProvider;
  openRouterProvider?: OpenRouterDirectorProvider;
  logger?: Logger;
}

interface ProviderRoute {
  id: string;
  providerName: "gemini" | "openrouter";
  modelName: string;
  isConfigured: () => boolean;
  execute: (
    action: "analyze" | "repair",
    input: DirectorPromptInput | DirectorRepairInput,
    budget: DirectorExecutionBudget
  ) => Promise<RawDirectorOutput>;
}

export class ResilientDirectorProvider implements DirectorAiProvider {
  readonly id = "resilient-director";
  readonly modelName: string;
  readonly fallbackModelName?: string;
  readonly openRouterModelName?: string;

  private readonly geminiProvider: GeminiDirectorProvider;
  private readonly openRouterProvider?: OpenRouterDirectorProvider;
  private readonly logger?: Logger;

  constructor(options: ResilientDirectorProviderOptions) {
    this.geminiProvider = options.geminiProvider;
    this.openRouterProvider = options.openRouterProvider;
    this.logger = options.logger;

    this.modelName = this.geminiProvider.modelName;
    this.fallbackModelName = this.geminiProvider.fallbackModelName;
    this.openRouterModelName = this.openRouterProvider?.modelName;
  }

  isConfigured(): boolean {
    return (
      this.geminiProvider.isConfigured() ||
      Boolean(this.openRouterProvider && this.openRouterProvider.isConfigured())
    );
  }

  async analyze(input: DirectorPromptInput): Promise<RawDirectorOutput> {
    const budget = input.budget ?? new DirectorExecutionBudget();
    return this.executeWithResilience("analyze", input, budget);
  }

  async repair(input: DirectorRepairInput): Promise<RawDirectorOutput> {
    const budget = input.budget ?? new DirectorExecutionBudget();
    return this.executeWithResilience("repair", input, budget);
  }

  private getRoutes(): ProviderRoute[] {
    const routes: ProviderRoute[] = [];

    // Route 1: Gemini Primary (gemini-3.7-flash)
    if (this.geminiProvider.isConfigured()) {
      routes.push({
        id: "gemini-primary",
        providerName: "gemini",
        modelName: this.geminiProvider.modelName,
        isConfigured: () => this.geminiProvider.isConfigured(),
        execute: async (action, input) => {
          return this.geminiProvider.callDirect(
            action,
            this.geminiProvider.modelName,
            input
          );
        },
      });

      // Route 2: Gemini Google Fallback (gemini-3.6-flash)
      if (
        this.geminiProvider.fallbackModelName &&
        this.geminiProvider.fallbackModelName !== this.geminiProvider.modelName
      ) {
        routes.push({
          id: "gemini-fallback",
          providerName: "gemini",
          modelName: this.geminiProvider.fallbackModelName,
          isConfigured: () => this.geminiProvider.isConfigured(),
          execute: async (action, input) => {
            return this.geminiProvider.callDirect(
              action,
              this.geminiProvider.fallbackModelName,
              input
            );
          },
        });
      }
    }

    // Route 3: OpenRouter MiniMax Cross-Provider Fallback
    if (this.openRouterProvider && this.openRouterProvider.isConfigured()) {
      const openRouter = this.openRouterProvider;
      routes.push({
        id: "openrouter",
        providerName: "openrouter",
        modelName: openRouter.modelName,
        isConfigured: () => openRouter.isConfigured(),
        execute: async (action, input, budget) => {
          return openRouter.callDirect(action, input, budget);
        },
      });
    }

    return routes;
  }

  private async executeWithResilience(
    action: "analyze" | "repair",
    input: DirectorPromptInput | DirectorRepairInput,
    budget: DirectorExecutionBudget
  ): Promise<RawDirectorOutput> {
    const startTime = Date.now();
    const routes = this.getRoutes();

    if (routes.length === 0) {
      throw new ProviderError(
        this.id,
        "No AI provider is configured. Please configure GEMINI_API_KEY or OPENROUTER_API_KEY.",
        {
          code: "AUTH_FAILURE",
          isConfigured: false,
        }
      );
    }

    if (!budget.hasRemainingBudget()) {
      throw new ProviderError(
        this.id,
        "Transport budget exhausted for this Director request",
        {
          code: "REQUEST_FAILED",
          totalCallsUsed: budget.totalCallsUsed,
          maxTotalCalls: budget.maxTotalCalls,
        }
      );
    }

    let lastError: unknown = null;

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      if (!route) {
        continue;
      }

      // Check if this route is eligible to make calls
      if (!budget.canMakeRouteCall(route.id, 2)) {
        continue;
      }

      while (budget.canMakeRouteCall(route.id, 2)) {
        // Starvation guard: calculate number of untried downstream routes
        const untriedDownstreamCount = routes
          .slice(i + 1)
          .filter((r) => (budget.routeAttempts.get(r.id) ?? 0) === 0).length;

        budget.recordRouteCall(route.id);

        try {
          const result = await route.execute(action, input, budget);
          return {
            ...result,
            model: route.modelName,
          };
        } catch (err: unknown) {
          lastError = err;

          // 1. Fatal Auth Failure for currently configured provider fails immediately
          if (err instanceof ProviderError && err.details?.code === "AUTH_FAILURE") {
            throw err;
          }

          // 2. Fatal Non-retryable semantic / schema / safety errors fail immediately
          if (this.isFatalSemanticError(err)) {
            throw err;
          }

          // 3. RATE_LIMITED (HTTP 429) is a SWITCH-ONLY condition: no same-route retry
          if (this.isRateLimitError(err)) {
            budget.recordRouteRateLimited(route.id);
            this.logFallbackTransition(routes, i, route, "RATE_LIMITED", budget, startTime);
            break; // Advance immediately to next downstream route
          }

          // 4. TIMEOUT is a SWITCH-ONLY condition: no consecutive timeouts on same route
          if (this.isTimeoutError(err)) {
            budget.recordRouteTimeout(route.id);
            this.logFallbackTransition(routes, i, route, "TIMEOUT", budget, startTime);
            break; // Advance immediately to next downstream route
          }

          // 5. Upstream / Network transient failures (500, 502, 503, 504, connection errors)
          if (this.isFallbackEligibleError(err)) {
            budget.recordFallbackEligible();

            // Allow same-route retry ONLY IF doing so does not starve untried downstream routes
            if (budget.canRetryOnRoute(route.id, untriedDownstreamCount, 2)) {
              const currentAttempts = budget.routeAttempts.get(route.id) ?? 1;
              const delayMs = Math.min(
                500 * Math.pow(2, currentAttempts - 1) + Math.random() * 50,
                2000
              );
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              continue; // Retry on same route
            }

            // Otherwise, switch promptly to next downstream route
            this.logFallbackTransition(routes, i, route, "UPSTREAM_UNAVAILABLE", budget, startTime);
            break;
          }

          // Unrecognized errors fail safely without infinite retry
          throw this.normalizeError(err);
        }
      }
    }

    throw this.normalizeError(lastError);
  }

  private isFatalSemanticError(err: unknown): boolean {
    if (err instanceof ProviderError) {
      const code = err.details?.code;
      return (
        code === "SCHEMA_VALIDATION_FAILED" ||
        code === "MALFORMED_JSON" ||
        code === "SAFETY_BLOCKED" ||
        code === "GENERATION_TERMINATED" ||
        code === "EMPTY_RESPONSE"
      );
    }
    return false;
  }

  private isRateLimitError(err: unknown): boolean {
    if (err instanceof ProviderError) {
      return err.details?.code === "RATE_LIMITED" || err.details?.status === 429;
    }
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return (
        msg.includes("429") ||
        msg.includes("rate limit") ||
        msg.includes("quota") ||
        msg.includes("resource_exhausted")
      );
    }
    return false;
  }

  private isTimeoutError(err: unknown): boolean {
    if (err instanceof ProviderError) {
      return err.details?.code === "TIMEOUT";
    }
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes("timeout") || msg.includes("etimedout") || err.name === "AbortError";
    }
    return false;
  }

  private isFallbackEligibleError(err: unknown): boolean {
    if (this.isFatalSemanticError(err)) {
      return false;
    }
    if (this.isTimeoutError(err) || this.isRateLimitError(err)) {
      return true;
    }
    if (err instanceof ProviderError) {
      const code = err.details?.code;
      return code === "UPSTREAM_UNAVAILABLE" || code === "NETWORK_FAILURE";
    }
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (
        msg.includes("500") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("504") ||
        msg.includes("unavailable") ||
        msg.includes("bad gateway") ||
        msg.includes("service unavailable") ||
        msg.includes("overloaded") ||
        msg.includes("internal server error")
      ) {
        return true;
      }
      if (
        msg.includes("econnreset") ||
        msg.includes("econnrefused") ||
        msg.includes("enotfound") ||
        msg.includes("fetch failed") ||
        msg.includes("network error") ||
        msg.includes("socket hang up")
      ) {
        return true;
      }
    }
    return false;
  }

  private logFallbackTransition(
    routes: ProviderRoute[],
    currentIndex: number,
    fromRoute: ProviderRoute,
    reason: string,
    budget: DirectorExecutionBudget,
    startTime: number
  ): void {
    if (!this.logger) return;

    const nextRoute = routes.slice(currentIndex + 1).find((r) => budget.canMakeRouteCall(r.id, 2));
    if (nextRoute) {
      const elapsedMs = Date.now() - startTime;
      this.logger.warn({
        event: "director.provider_fallback",
        fromProvider: fromRoute.providerName,
        toProvider: nextRoute.providerName,
        fromModel: fromRoute.modelName,
        toModel: nextRoute.modelName,
        reason,
        totalCallsUsed: budget.totalCallsUsed,
        elapsedMs,
      });
    }
  }

  private normalizeError(err: unknown): Error {
    if (err instanceof ProviderError) {
      return err;
    }
    if (this.isTimeoutError(err)) {
      return new ProviderError(this.id, "Director provider request timed out", {
        code: "TIMEOUT",
      });
    }
    if (this.isRateLimitError(err)) {
      return new ProviderError(this.id, "Director provider rate limited", {
        code: "RATE_LIMITED",
      });
    }
    if (this.isFallbackEligibleError(err)) {
      return new ProviderError(this.id, "Director provider upstream unavailable", {
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    return new ProviderError(this.id, "Director provider request failed", {
      code: "REQUEST_FAILED",
    });
  }
}
