import { AivaError } from "./aiva-error";

/**
 * Thrown when input fails domain/schema validation (e.g. Zod parse
 * failures). Maps to HTTP 400 at the API boundary.
 */
export class ValidationError extends AivaError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;

  static fromIssues(issues: Array<{ path: PropertyKey[]; message: string }>): ValidationError {
    const fieldErrors: Record<string, string> = {};
    for (const issue of issues) {
      const key = issue.path.join(".") || "_root";
      fieldErrors[key] = issue.message;
    }
    return new ValidationError("Validation failed", { fieldErrors });
  }
}
