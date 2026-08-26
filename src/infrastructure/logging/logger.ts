import { getEnv } from "@/infrastructure/config/env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Structured log fields. Kept intentionally generic so both current
 * domain events and future provider request/response diagnostics can use
 * the same shape.
 */
export interface LogContext {
  event: string;
  projectId?: string;
  sceneId?: string;
  provider?: string;
  durationMs?: number;
  message?: string;
  error?: unknown;
  [key: string]: unknown;
}

interface LogRecord {
  timestamp: string;
  level: LogLevel;
  event: string;
  message?: string;
  projectId?: string;
  sceneId?: string;
  provider?: string;
  durationMs?: number;
  error?: { name: string; message: string; stack?: string } | string;
  [key: string]: unknown;
}

/**
 * Field names that must never reach a log sink, regardless of where they
 * appear in a context object. Matched case-insensitively against object
 * keys at any nesting depth.
 */
const SENSITIVE_KEY_PATTERN =
  /(api[-_]?key|apikey|secret|password|passwd|token|authorization|auth[-_]?header|credential|access[-_]?key|private[-_]?key)/i;

const REDACTED = "[REDACTED]";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}

function serializeError(error: unknown): LogRecord["error"] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (error === undefined) return undefined;
  return String(redact(error));
}

/**
 * Minimal structured logger. Emits one JSON object per line so log output
 * is machine-parseable from day one, without pulling in a logging
 * dependency for a foundation task.
 */
class Logger {
  private minWeight(): number {
    return LEVEL_WEIGHT[getEnv().AIVA_LOG_LEVEL];
  }

  private write(level: LogLevel, context: LogContext): void {
    if (LEVEL_WEIGHT[level] < this.minWeight()) return;

    const { event, message, projectId, sceneId, provider, durationMs, error, ...rest } = context;

    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...(message !== undefined ? { message } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      ...(sceneId !== undefined ? { sceneId } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(error !== undefined ? { error: serializeError(error) } : {}),
      ...(redact(rest) as Record<string, unknown>),
    };

    const line = JSON.stringify(record);
    if (level === "error") {
      // eslint-disable-next-line no-console
      console.error(line);
    } else if (level === "warn") {
      // eslint-disable-next-line no-console
      console.warn(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }

  debug(context: LogContext): void {
    this.write("debug", context);
  }

  info(context: LogContext): void {
    this.write("info", context);
  }

  warn(context: LogContext): void {
    this.write("warn", context);
  }

  error(context: LogContext): void {
    this.write("error", context);
  }
}

export const logger = new Logger();
