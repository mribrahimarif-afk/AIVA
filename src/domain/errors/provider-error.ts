import { AivaError } from "./aiva-error";

/**
 * Thrown by provider adapters (AI, voice, stock, video) when an external
 * integration fails or is not configured. No provider is implemented in
 * TASK-001; this type exists so future provider work has a consistent
 * error shape to throw from day one. Maps to HTTP 502.
 */
export class ProviderError extends AivaError {
  readonly code = "PROVIDER_ERROR";
  readonly httpStatus = 502;

  readonly provider: string;

  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.provider = provider;
  }
}
