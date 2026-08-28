import { ProviderError } from "@/domain/errors";

export interface NormalizedProviderFailure {
  provider: string;
  code: string;
  safeMessage: string;
  httpStatus?: number;
}

const STATIC_SAFE_MESSAGES: Record<string, Record<string, string>> = {
  "gemini-transcribe": {
    UNCONFIGURED: "Gemini transcription is not configured.",
    AUTH_FAILED: "Gemini transcription authentication failed.",
    FORBIDDEN: "Gemini transcription permission denied.",
    RATE_LIMITED: "Gemini transcription is temporarily rate limited.",
    TIMEOUT: "Gemini transcription timed out.",
    NETWORK_FAILURE: "Gemini transcription network failure.",
    UPSTREAM_UNAVAILABLE: "Gemini transcription service is unavailable.",
    MODEL_UNAVAILABLE: "Gemini transcription model is unavailable.",
    MALFORMED_RESPONSE: "Gemini transcription returned a malformed response.",
    MISSING_TIMESTAMPS: "Gemini transcription is missing word-level timestamps.",
    INVALID_REQUEST: "Gemini transcription request is invalid.",
    INVALID_INPUT: "Gemini transcription input is invalid.",
    GENERIC_ERROR: "Gemini transcription failed.",
  },
  "azure-speech-stt": {
    UNCONFIGURED: "Azure Speech-to-Text is not configured.",
    AUTH_FAILED: "Azure transcription authentication failed.",
    FORBIDDEN: "Azure transcription permission denied.",
    RATE_LIMITED: "Azure transcription is temporarily rate limited.",
    TIMEOUT: "Azure transcription timed out.",
    NETWORK_FAILURE: "Azure transcription network failure.",
    UPSTREAM_UNAVAILABLE: "Azure transcription service is unavailable.",
    MODEL_UNAVAILABLE: "Azure transcription model is unavailable.",
    MALFORMED_RESPONSE: "Azure transcription returned a malformed response.",
    MISSING_TIMESTAMPS: "Azure transcription is missing word-level timestamps.",
    NO_SPEECH: "No speech detected in audio.",
    GENERIC_ERROR: "Azure transcription failed.",
  },
  "elevenlabs-scribe": {
    DISABLED: "ElevenLabs transcription is currently disabled.",
    UNCONFIGURED: "ElevenLabs transcription is not configured.",
    AUTH_FAILED: "ElevenLabs transcription authentication failed.",
    FORBIDDEN: "ElevenLabs transcription permission denied.",
    RATE_LIMITED: "ElevenLabs transcription is temporarily rate limited.",
    TIMEOUT: "ElevenLabs transcription timed out.",
    NETWORK_FAILURE: "ElevenLabs transcription network failure.",
    UPSTREAM_UNAVAILABLE: "ElevenLabs transcription service is unavailable.",
    MODEL_UNAVAILABLE: "ElevenLabs transcription model is unavailable.",
    MALFORMED_RESPONSE: "ElevenLabs transcription returned a malformed response.",
    MISSING_TIMESTAMPS: "ElevenLabs transcription is missing word-level timestamps.",
    INVALID_REQUEST: "ElevenLabs transcription request is invalid.",
    GENERIC_ERROR: "ElevenLabs transcription failed.",
  },
};

/**
 * Normalizes any provider-level failure into a safe, localized ProviderError.
 * Ensures zero raw upstream messages, credentials, file paths, or transcripts escape.
 */
export function normalizeProviderError(
  provider: string,
  rawError: unknown
): ProviderError {
  if (rawError instanceof ProviderError) {
    const rawDetails = rawError.details as Record<string, unknown> | undefined;
    const code =
      typeof rawDetails?.code === "string"
        ? rawDetails.code
        : rawError.code !== "PROVIDER_ERROR"
          ? rawError.code
          : "GENERIC_ERROR";

    const safeMsg =
      STATIC_SAFE_MESSAGES[provider]?.[code] ||
      STATIC_SAFE_MESSAGES[provider]?.GENERIC_ERROR ||
      "Transcription provider failed.";

    const rawStatus = (rawError as { status?: number }).status;
    return new ProviderError(provider, safeMsg, {
      code,
      status: rawStatus,
      provider,
    });
  }

  const rawMessage = rawError instanceof Error ? rawError.message : String(rawError || "");
  let code = "UPSTREAM_UNAVAILABLE";
  let status: number | undefined;

  // Extract HTTP status code if present
  const statusMatch = rawMessage.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
  if (statusMatch && statusMatch[1]) {
    status = parseInt(statusMatch[1], 10);
  }

  if (rawError instanceof Error && (rawError.name === "AbortError" || rawError.name === "TimeoutError")) {
    code = "TIMEOUT";
  } else if (status === 401 || /auth|unauthorized|api[-_]?key/i.test(rawMessage)) {
    code = "AUTH_FAILED";
  } else if (status === 403 || /forbidden|permission/i.test(rawMessage)) {
    code = "FORBIDDEN";
  } else if (status === 404 || /not[-_]?found/i.test(rawMessage)) {
    code = "MODEL_UNAVAILABLE";
  } else if (status === 429 || /rate|quota|too many requests/i.test(rawMessage)) {
    code = "RATE_LIMITED";
  } else if (status === 408 || /timeout|deadline/i.test(rawMessage)) {
    code = "TIMEOUT";
  } else if (/network|econnrefused|enotfound|fetch failed/i.test(rawMessage)) {
    code = "NETWORK_FAILURE";
  }

  const safeMsg =
    STATIC_SAFE_MESSAGES[provider]?.[code] ||
    STATIC_SAFE_MESSAGES[provider]?.GENERIC_ERROR ||
    "Transcription provider failed.";

  return new ProviderError(provider, safeMsg, {
    code,
    status,
    provider,
  });
}
