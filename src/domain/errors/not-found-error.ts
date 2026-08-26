import { AivaError } from "./aiva-error";

/**
 * Thrown when a requested domain entity does not exist. Maps to HTTP 404.
 */
export class NotFoundError extends AivaError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
}
