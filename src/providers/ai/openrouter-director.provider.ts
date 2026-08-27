import { ProviderError } from "@/domain/errors";
import { rawDirectorOutputSchema } from "@/domain/director/director.schema";
import type { RawDirectorOutput } from "@/domain/director/director.types";
import type {
  DirectorAiProvider,
  DirectorPromptInput,
  DirectorRepairInput,
  DirectorExecutionBudget,
} from "./ai-provider.interface";
import { SYSTEM_INSTRUCTION } from "./gemini-director.provider";
import type { Logger } from "@/infrastructure/logging/logger";

export interface OpenRouterDirectorProviderOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  logger?: Logger;
}

export function buildSharedDirectorAnalysisPrompt(input: DirectorPromptInput): string {
  const lines: string[] = [];

  lines.push("# TASK: DIRECT VIDEO SCENE BREAKDOWN");

  if (input.brandContext) {
    lines.push(`\n## BRAND CONTEXT\nBrand: ${input.brandContext.name}`);
  }

  if (input.productContext) {
    lines.push(`\n## PRODUCT CONTEXT`);
    lines.push(`Product: ${input.productContext.name}`);
    if (input.productContext.description) {
      lines.push(`Description: ${input.productContext.description}`);
    }
    if (input.productContext.aliases.length > 0) {
      lines.push(`Aliases: ${input.productContext.aliases.join(", ")}`);
    }
  }

  lines.push(`\n## UNTRUSTED SCRIPT UNITS (Preserve 100% exact coverage in sequence)`);
  for (const unit of input.scriptUnits) {
    lines.push(`[${unit.id}] ${unit.text}`);
  }

  lines.push(
    `\nAnalyze the script above and return the complete Scene Plan JSON adhering to all constraints.`
  );

  return lines.join("\n");
}

export function buildSharedDirectorRepairPrompt(input: DirectorRepairInput): string {
  const lines: string[] = [];

  lines.push("# REPAIR TASK: FIX SCENE PLAN VALIDATION ERRORS");
  lines.push(
    "Your previous scene plan proposal failed local invariant validation. Correct the errors listed below while preserving 100% exact ScriptUnit coverage."
  );

  lines.push("\n## VALIDATION ERRORS TO FIX:");
  for (const err of input.validationErrors) {
    lines.push(`- ${err}`);
  }

  lines.push("\n## ORIGINAL SCRIPT UNITS:");
  for (const unit of input.scriptUnits) {
    lines.push(`[${unit.id}] ${unit.text}`);
  }

  if (input.rawOutput) {
    lines.push(
      `\n## PREVIOUS INVALID OUTPUT:\n${JSON.stringify(input.rawOutput, null, 2).slice(0, 4000)}`
    );
  }

  lines.push(
    "\nReturn the corrected Scene Plan JSON strictly resolving all listed validation errors."
  );

  return lines.join("\n");
}

export class OpenRouterDirectorProvider implements DirectorAiProvider {
  readonly id = "openrouter-director";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;

  constructor(options: OpenRouterDirectorProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim() || "";
    this.modelName = options.model?.trim() || "minimax/minimax-m3:free";
    this.logger = options.logger;
    this.timeoutMs =
      typeof options.timeoutMs === "number" &&
      Number.isFinite(options.timeoutMs) &&
      options.timeoutMs > 0
        ? Math.min(Math.floor(options.timeoutMs), 300000)
        : 45000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  async analyze(input: DirectorPromptInput): Promise<RawDirectorOutput> {
    this.assertConfigured();
    const prompt = buildSharedDirectorAnalysisPrompt(input);
    return this.executeCall(prompt, input.budget, true);
  }

  async repair(input: DirectorRepairInput): Promise<RawDirectorOutput> {
    this.assertConfigured();
    const prompt = buildSharedDirectorRepairPrompt(input);
    return this.executeCall(prompt, input.budget, true);
  }

  async callDirect(
    action: "analyze" | "repair",
    input: DirectorPromptInput | DirectorRepairInput,
    budget?: DirectorExecutionBudget
  ): Promise<RawDirectorOutput> {
    this.assertConfigured();
    const prompt =
      action === "analyze"
        ? buildSharedDirectorAnalysisPrompt(input as DirectorPromptInput)
        : buildSharedDirectorRepairPrompt(input as DirectorRepairInput);
    return this.executeCall(prompt, budget, false);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.id,
        "OpenRouter API key is not configured. Director fallback is unavailable.",
        {
          code: "AUTH_FAILURE",
          isConfigured: false,
        }
      );
    }
  }

  private async executeCall(
    prompt: string,
    budget?: DirectorExecutionBudget,
    recordCall = true
  ): Promise<RawDirectorOutput> {
    if (budget && recordCall) {
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
      budget.recordRouteCall("openrouter");
    }

    const controller = new AbortController();
    const timerId = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "AIVA Studio V4",
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: [
            { role: "system", content: SYSTEM_INSTRUCTION },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const status = response.status;
        let safeErrorDetail = "REQUEST_FAILED";

        if (status === 401 || status === 403) {
          safeErrorDetail = "AUTH_FAILURE";
          throw new ProviderError(this.id, "OpenRouter authentication failed", {
            code: "AUTH_FAILURE",
            status,
          });
        }

        if (status === 429) {
          if (budget) {
            budget.recordRouteRateLimited("openrouter");
          }
          throw new ProviderError(this.id, "OpenRouter rate limited", {
            code: "RATE_LIMITED",
            status: 429,
          });
        }

        if (status >= 500 && status <= 504) {
          safeErrorDetail = "UPSTREAM_UNAVAILABLE";
          if (budget) {
            budget.recordFallbackEligible();
          }
          throw new ProviderError(this.id, "OpenRouter service unavailable", {
            code: "UPSTREAM_UNAVAILABLE",
            status,
          });
        }

        // Try reading error text safely without leaking sensitive payload
        let errorBodyText = "";
        try {
          errorBodyText = await response.text();
        } catch {
          // ignore
        }

        const lowerError = errorBodyText.toLowerCase();
        if (
          lowerError.includes("unavailable") ||
          lowerError.includes("overloaded") ||
          lowerError.includes("free model") ||
          lowerError.includes("temporarily")
        ) {
          if (budget) {
            budget.recordFallbackEligible();
          }
          throw new ProviderError(this.id, "OpenRouter model unavailable", {
            code: "UPSTREAM_UNAVAILABLE",
            status,
          });
        }

        throw new ProviderError(this.id, "OpenRouter request failed", {
          code: safeErrorDetail,
          status,
        });
      }

      let responseData: {
        choices?: Array<{
          message?: {
            content?: string;
          };
          finish_reason?: string;
        }>;
      };

      try {
        responseData = (await response.json()) as typeof responseData;
      } catch {
        throw new ProviderError(this.id, "OpenRouter returned non-JSON response payload", {
          code: "MALFORMED_JSON",
        });
      }

      const rawContent = responseData.choices?.[0]?.message?.content?.trim();
      if (!rawContent) {
        throw new ProviderError(this.id, "OpenRouter returned an empty response", {
          code: "EMPTY_RESPONSE",
        });
      }

      // Parse JSON assistant content
      let parsedJson: unknown;
      try {
        // Strip markdown fences if present
        let cleanedContent = rawContent;
        if (cleanedContent.startsWith("```json")) {
          cleanedContent = cleanedContent.replace(/^```json\s*/, "").replace(/\s*```$/, "");
        } else if (cleanedContent.startsWith("```")) {
          cleanedContent = cleanedContent.replace(/^```\s*/, "").replace(/\s*```$/, "");
        }
        parsedJson = JSON.parse(cleanedContent);
      } catch {
        throw new ProviderError(this.id, "OpenRouter returned malformed JSON content", {
          code: "MALFORMED_JSON",
        });
      }

      const validated = rawDirectorOutputSchema.safeParse(parsedJson);
      if (!validated.success) {
        throw new ProviderError(this.id, "OpenRouter structured output failed schema validation", {
          code: "SCHEMA_VALIDATION_FAILED",
        });
      }

      return {
        ...validated.data,
        model: this.modelName,
      };
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        throw err;
      }

      if (err instanceof Error) {
        if (err.name === "AbortError" || err.message.toLowerCase().includes("aborted")) {
          if (budget) {
            budget.recordRouteTimeout("openrouter");
          }
          throw new ProviderError(
            this.id,
            `OpenRouter request timed out after ${this.timeoutMs}ms`,
            {
              code: "TIMEOUT",
              timeoutMs: this.timeoutMs,
            }
          );
        }

        const msg = err.message.toLowerCase();
        if (
          msg.includes("fetch failed") ||
          msg.includes("econnrefused") ||
          msg.includes("enotfound") ||
          msg.includes("econnreset") ||
          msg.includes("socket hang up") ||
          msg.includes("network error")
        ) {
          if (budget) {
            budget.recordFallbackEligible();
          }
          throw new ProviderError(this.id, "OpenRouter network failure", {
            code: "NETWORK_FAILURE",
          });
        }
      }

      throw new ProviderError(this.id, "OpenRouter unexpected error", {
        code: "REQUEST_FAILED",
      });
    } finally {
      clearTimeout(timerId);
    }
  }
}
