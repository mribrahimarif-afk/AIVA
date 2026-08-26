import { AivaError } from "./aiva-error";

/**
 * Thrown when filesystem/workspace operations fail (directory creation,
 * path resolution, permission issues). Maps to HTTP 500.
 */
export class StorageError extends AivaError {
  readonly code = "STORAGE_ERROR";
  readonly httpStatus = 500;
}
