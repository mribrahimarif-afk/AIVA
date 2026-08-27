import { AivaError } from "./aiva-error";

/**
 * Thrown when a business logic or domain invariant is violated.
 * Maps to HTTP 400 at the API boundary with the specific domain code.
 */
export class DomainError extends AivaError {
  readonly code: string;
  readonly httpStatus = 400;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}
