import { NextResponse } from "next/server";
import { AivaError } from "@/domain/errors";
import { logger } from "@/infrastructure/logging/logger";

/**
 * Single place that turns any thrown error into an HTTP response. Keeps
 * API routes free of ad-hoc try/catch error-shaping logic.
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AivaError) {
    if (error.httpStatus >= 500) {
      logger.error({ event: "api.error", error, message: error.message });
    }
    return NextResponse.json({ error: error.toJSON() }, { status: error.httpStatus });
  }

  logger.error({ event: "api.unhandled_error", error });
  return NextResponse.json(
    { error: { name: "InternalError", code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
    { status: 500 }
  );
}
