import { NextResponse } from "next/server";
import { AivaError } from "@/domain/errors";
import { logger } from "@/infrastructure/logging/logger";

const GENERIC_SERVER_MESSAGE = "An internal error occurred";

/**
 * Single place that turns any thrown error into an HTTP response. Keeps
 * API routes free of ad-hoc try/catch error-shaping logic.
 *
 * Server-side failures (httpStatus >= 500 — StorageError, ProviderError,
 * RenderError, and any future internal error) never expose their message
 * or `details` to the client: those can carry filesystem paths, upstream
 * provider response bodies, or other internals. The full error is still
 * logged (and passed through the logger's own secret redaction) for
 * operators. Client-fault errors (400/404 — ValidationError,
 * NotFoundError) keep their message/details since the UI relies on them
 * (e.g. field-level validation errors).
 */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AivaError) {
    const isServerFault = error.httpStatus >= 500;

    if (isServerFault) {
      logger.error({ event: "api.error", error, code: error.code, details: error.details });
    }

    return NextResponse.json(
      {
        error: {
          name: error.name,
          code: error.code,
          message: isServerFault ? GENERIC_SERVER_MESSAGE : error.message,
          ...(!isServerFault && error.details ? { details: error.details } : {}),
        },
      },
      { status: error.httpStatus }
    );
  }

  logger.error({ event: "api.unhandled_error", error });
  return NextResponse.json(
    { error: { name: "InternalError", code: "INTERNAL_ERROR", message: GENERIC_SERVER_MESSAGE } },
    { status: 500 }
  );
}
