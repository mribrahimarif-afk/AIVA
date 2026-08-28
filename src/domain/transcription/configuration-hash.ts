import crypto from "crypto";
import type { TranscriptionMode } from "./transcription.types";

export const CANONICAL_BUILDER_VERSION = "v1";
export const ROUTING_POLICY_VERSION = "v1";

export interface ComputeConfigHashOptions {
  sourceAudioHash: string;
  requestedMode: TranscriptionMode;
  geminiModel?: string;
  azureModel?: string;
  elevenLabsModel?: string;
  routingPolicyVersion?: string;
  canonicalBuilderVersion?: string;
  languageHints?: string[];
  vocabularyHash?: string | null;
}

function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonStringify).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJsonStringify((obj as Record<string, unknown>)[k])}`
  );
  return `{${entries.join(",")}}`;
}

/**
 * Computes a deterministic SHA-256 configuration hash representing all
 * transcription-affecting parameters for durable, cost-safe reuse.
 *
 * Operational parameters (API keys, operational timeouts) are never included.
 */
export function computeTranscriptionConfigHash(options: ComputeConfigHashOptions): string {
  const {
    sourceAudioHash,
    requestedMode,
    geminiModel = "gemini-3.5-transcribe",
    azureModel = "azure-speech-continuous-stt",
    elevenLabsModel = "scribe_v2",
    routingPolicyVersion = ROUTING_POLICY_VERSION,
    canonicalBuilderVersion = CANONICAL_BUILDER_VERSION,
    languageHints = [],
    vocabularyHash = null,
  } = options;

  let configObject: Record<string, unknown>;

  if (requestedMode === "AUTO") {
    configObject = {
      version: 2,
      sourceAudioHash,
      requestedMode: "AUTO",
      routingPolicyVersion,
      routing: [
        { provider: "gemini-transcribe", model: geminiModel },
        { provider: "azure-speech-stt", model: azureModel },
      ],
      transcriptionMode: "verbatim",
      timestampGranularity: "word",
      languageHints: languageHints.slice().sort(),
      vocabularyHash,
      canonicalBuilderVersion,
    };
  } else if (requestedMode === "GEMINI") {
    configObject = {
      version: 2,
      sourceAudioHash,
      requestedMode: "GEMINI",
      provider: "gemini-transcribe",
      model: geminiModel,
      transcriptionMode: "verbatim",
      timestampGranularity: "word",
      languageHints: languageHints.slice().sort(),
      vocabularyHash,
      canonicalBuilderVersion,
    };
  } else if (requestedMode === "AZURE") {
    configObject = {
      version: 2,
      sourceAudioHash,
      requestedMode: "AZURE",
      provider: "azure-speech-stt",
      model: azureModel,
      normalization: "16khz_16bit_mono_pcm",
      timestampGranularity: "word",
      languageHints: languageHints.slice().sort(),
      vocabularyHash,
      canonicalBuilderVersion,
    };
  } else {
    configObject = {
      version: 2,
      sourceAudioHash,
      requestedMode: "ELEVENLABS",
      provider: "elevenlabs-scribe",
      model: elevenLabsModel,
      timestampGranularity: "word",
      canonicalBuilderVersion,
    };
  }

  // Stable deterministic recursive serialization
  const serialized = canonicalJsonStringify(configObject);
  return crypto.createHash("sha256").update(serialized).digest("hex").toLowerCase();
}
