import { AivaError } from "./aiva-error";

/**
 * Thrown when a value read back from the database doesn't satisfy the
 * domain's own validation rules (e.g. a `status`/`type` column holding a
 * string outside the current enum — SQLite enforces no such constraint,
 * so this can only be caught at the application boundary). Signals a
 * corrupted or manually-edited record rather than a client mistake, so
 * it maps to HTTP 500, not 400.
 */
export class DataIntegrityError extends AivaError {
  readonly code = "DATA_INTEGRITY_ERROR";
  readonly httpStatus = 500;
}
