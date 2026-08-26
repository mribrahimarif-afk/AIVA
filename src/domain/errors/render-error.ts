import { AivaError } from "./aiva-error";

/**
 * Thrown by the (future) rendering pipeline. No rendering is implemented
 * in TASK-001; this type is a placeholder so downstream code can rely on
 * a stable error contract when render work begins. Maps to HTTP 500.
 */
export class RenderError extends AivaError {
  readonly code = "RENDER_ERROR";
  readonly httpStatus = 500;
}
