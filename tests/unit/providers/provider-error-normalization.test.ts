import { describe, it, expect } from "vitest";
import { normalizeProviderError } from "@/providers/transcription/provider-error-normalizer";
import { GeminiTranscribeProvider } from "@/providers/transcription/gemini-transcribe.provider";
import { AzureTranscribeProvider } from "@/providers/transcription/azure-transcribe.provider";
import { ElevenLabsTranscribeProvider } from "@/providers/transcription/elevenlabs-transcribe.provider";

describe("Provider Error Normalization & Privacy Leakage Prevention", () => {
  const MALICIOUS_PATTERNS = [
    "Bearer SECRET_BEARER_TOKEN",
    "Authorization: Bearer SUPER_SECRET",
    "api-key=SUPER_SECRET",
    "x-goog-api-key: SUPER_SECRET",
    "xi-api-key: SUPER_SECRET",
    "Ocp-Apim-Subscription-Key: SUPER_SECRET",
    "AIzaSySUPER_SECRET_VALUE",
    "sk_SUPER_SECRET_VALUE",
    "C:\\Users\\Usman\\Private\\voice.wav",
    "C:/Users/Usman/Private/voice.wav",
    "/home/usman/private/voice.wav",
    "/tmp/aiva/private-source.wav",
    "My private sentence must never appear",
    '{"error":{"message":"PRIVATE TRANSCRIPT api-key=SUPER_SECRET"}}',
  ];

  it("normalizes arbitrary malicious error strings without leaking sensitive tokens or paths", () => {
    for (const pattern of MALICIOUS_PATTERNS) {
      const rawError = new Error(`Critical failure occurred: ${pattern}`);
      
      const geminiNormalized = normalizeProviderError("gemini-transcribe", rawError);
      const azureNormalized = normalizeProviderError("azure-speech-stt", rawError);
      const elevenLabsNormalized = normalizeProviderError("elevenlabs-scribe", rawError);

      for (const norm of [geminiNormalized, azureNormalized, elevenLabsNormalized]) {
        // Assert malicious pattern does not appear in public message
        expect(norm.message).not.toContain(pattern);
        expect(norm.message).not.toContain("SUPER_SECRET");
        expect(norm.message).not.toContain("Private");
        expect(norm.message).not.toContain("private-source");
        expect(norm.message).not.toContain("PRIVATE TRANSCRIPT");

        // Assert message is static and safe
        expect(typeof norm.message).toBe("string");
        expect(norm.message.length).toBeGreaterThan(0);

        // Assert details object does not contain raw string
        const detailsJson = JSON.stringify(norm.details || {});
        expect(detailsJson).not.toContain(pattern);
        expect(detailsJson).not.toContain("SUPER_SECRET");
        expect(detailsJson).not.toContain("PRIVATE TRANSCRIPT");
      }
    }
  });

  it("Gemini provider returns static safe message and does not leak API keys or paths", async () => {
    const mockFetch = async () => {
      throw new Error("HTTP 401: Unauthorized request with key AIzaSySUPER_SECRET_VALUE at /tmp/aiva/private-source.wav");
    };

    const provider = new GeminiTranscribeProvider({
      apiKey: "AIzaSySUPER_SECRET_VALUE",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    try {
      await provider.transcribe({
        audioBuffer: Buffer.from("dummy"),
        mimeType: "audio/wav",
        projectId: "p1",
        audioSourceId: "s1",
        requestedMode: "GEMINI",
      });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const errMessage = (err as Error).message;
      expect(errMessage).toBe("Gemini transcription authentication failed.");
      expect(errMessage).not.toContain("AIzaSy");
      expect(errMessage).not.toContain("/tmp/aiva");
    }
  });

  it("ElevenLabs provider returns static safe message and does not leak raw body or transcript", async () => {
    const mockFetch = async () => {
      return new Response('{"error":{"message":"PRIVATE TRANSCRIPT xi-api-key=SUPER_SECRET"}}', {
        status: 401,
      });
    };

    const provider = new ElevenLabsTranscribeProvider({
      apiKey: "SUPER_SECRET",
      enabled: true,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    try {
      await provider.transcribe({
        audioBuffer: Buffer.from("dummy"),
        mimeType: "audio/wav",
        projectId: "p1",
        audioSourceId: "s1",
        requestedMode: "ELEVENLABS",
      });
      expect.unreachable("Should have thrown");
    } catch (err: unknown) {
      const errMessage = (err as Error).message;
      expect(errMessage).toBe("ElevenLabs transcription authentication failed.");
      expect(errMessage).not.toContain("SUPER_SECRET");
      expect(errMessage).not.toContain("PRIVATE TRANSCRIPT");
    }
  });
});
