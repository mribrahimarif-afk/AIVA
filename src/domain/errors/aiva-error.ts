/**
 * Base class for all application errors in AIVA Studio.
 *
 * Every domain-specific error extends this so that API routes and UI error
 * boundaries can handle failures uniformly instead of branching on
 * ad-hoc error shapes scattered through the codebase.
 */
export abstract class AivaError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): { name: string; code: string; message: string; details?: Record<string, unknown> } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
