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

/**
 * Patterns for key-value / prefix matches where group 1 is a human-readable
 * prefix (e.g. "Bearer " or "api_key: ") to preserve, while redacting the value.
 */
const PREFIX_SECRET_PATTERNS: RegExp[] = [
  /(bearer\s+)([A-Za-z0-9\-_.~+/]+=*)/gi,
  /((?:api[-_]?key|apikey|secret|password|passwd|token|access[-_]?key|private[-_]?key|authorization)\s*[:=]\s*)([^\s"'&,;]+)/gi,
];

/**
 * Patterns for bare, standalone provider tokens where the ENTIRE matched token
 * must be replaced with [REDACTED], without preserving any part of the token.
 */
const BARE_TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9\-_]{10,}\b/g,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/g,
  /\bAIza[0-9A-Za-z\-_]{30,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
];

function redactString(value: string): string {
  let out = value;
  for (const pattern of PREFIX_SECRET_PATTERNS) {
    out = out.replace(pattern, (_match, prefix: string) => `${prefix}${REDACTED}`);
  }
  for (const pattern of BARE_TOKEN_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Recursively redacts a value before it is serialized to a log line:
 * - object keys matching SENSITIVE_KEY_PATTERN are fully redacted
 * - every remaining string leaf (including ones nested under an
 *   innocuous-looking key) is scanned for secret-shaped content
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;

  if (typeof value === "string") {
    return redactString(value);
  }

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
      message: redactString(error.message),
      ...(error.stack ? { stack: redactString(error.stack) } : {}),
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
      ...(message !== undefined ? { message: redactString(message) } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      ...(sceneId !== undefined ? { sceneId } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(error !== undefined ? { error: serializeError(error) } : {}),
      ...(redact(rest) as Record<string, unknown>),
    };

    const line = JSON.stringify(record);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
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

export { Logger };
export const logger = new Logger();

