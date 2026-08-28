import { describe, it, expect } from "vitest";
import { computeTranscriptionConfigHash } from "@/domain/transcription/configuration-hash";

describe("computeTranscriptionConfigHash Deterministic Identity Tests (TASK-004B)", () => {
  const baseAudioHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("1. identical AUTO configuration produces identical hash for cost-safe reuse", () => {
    const hash1 = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
    });
    const hash2 = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
    });
    expect(hash1).toBe(hash2);
  });

  it("2. changed Gemini model invalidates AUTO reuse", () => {
    const hashDefault = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      geminiModel: "gemini-3.5-transcribe",
    });
    const hashCustom = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      geminiModel: "gemini-3.5-custom-model",
    });
    expect(hashDefault).not.toBe(hashCustom);
  });

  it("3. changed routing policy version invalidates AUTO reuse", () => {
    const hashV1 = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      routingPolicyVersion: "v1",
    });
    const hashV2 = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      routingPolicyVersion: "v2",
    });
    expect(hashV1).not.toBe(hashV2);
  });

  it("4. changed canonical builder version invalidates reuse", () => {
    const hashV1 = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      canonicalBuilderVersion: "v1",
    });
    const hashV2 = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      canonicalBuilderVersion: "v2",
    });
    expect(hashV1).not.toBe(hashV2);
  });

  it("5. same audio with GEMINI vs AZURE vs ELEVENLABS produces distinct non-colliding hashes", () => {
    const geminiHash = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "GEMINI",
    });
    const azureHash = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AZURE",
    });
    const autoHash = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
    });
    const elevenLabsHash = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "ELEVENLABS",
    });

    const set = new Set([geminiHash, azureHash, autoHash, elevenLabsHash]);
    expect(set.size).toBe(4);
  });

  it("6. different audio hashes produce distinct non-colliding configuration hashes", () => {
    const hashA = computeTranscriptionConfigHash({
      sourceAudioHash: "audio_hash_aaa",
      requestedMode: "AUTO",
    });
    const hashB = computeTranscriptionConfigHash({
      sourceAudioHash: "audio_hash_bbb",
      requestedMode: "AUTO",
    });
    expect(hashA).not.toBe(hashB);
  });

  it("7. language hints and vocabulary affect configuration hash", () => {
    const hashNormal = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      languageHints: ["en", "ur"],
    });
    const hashDifferentLang = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      languageHints: ["fr"],
    });
    const hashWithVocab = computeTranscriptionConfigHash({
      sourceAudioHash: baseAudioHash,
      requestedMode: "AUTO",
      languageHints: ["en", "ur"],
      vocabularyHash: "vocab_hash_123",
    });

    expect(hashNormal).not.toBe(hashDifferentLang);
    expect(hashNormal).not.toBe(hashWithVocab);
  });
});
