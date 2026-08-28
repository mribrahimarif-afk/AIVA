import { describe, it, expect, vi } from "vitest";
import { ElevenLabsTranscribeProvider } from "@/providers/transcription/elevenlabs-transcribe.provider";
import { ProviderError } from "@/domain/errors";

describe("ElevenLabsTranscribeProvider Unit Tests (TASK-004B Future-Ready Scribe v2)", () => {
  it("is disabled by default and rejects transcription attempts with code DISABLED", async () => {
    const provider = new ElevenLabsTranscribeProvider({
      enabled: false,
      apiKey: "el-key-123",
    });

    expect(provider.isEnabled()).toBe(false);
    expect(provider.isConfigured()).toBe(false);

    await expect(
      provider.transcribe({
        audioBuffer: Buffer.from("dummy"),
        mimeType: "audio/wav",
        projectId: "p1",
        audioSourceId: "s1",
        requestedMode: "ELEVENLABS",
      })
    ).rejects.toMatchObject({
      details: { code: "DISABLED" },
    });
  });

  it("successfully transcribes via Scribe v2 when explicitly enabled and configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        text: "Yeh zabardast product hai",
        language_code: "ur",
        words: [
          { text: "Yeh", start: 0.0, end: 0.3 },
          { text: "zabardast", start: 0.35, end: 0.9 },
          { text: "product", start: 0.95, end: 1.4 },
          { text: "hai", start: 1.45, end: 1.8 },
        ],
      }),
    });

    const provider = new ElevenLabsTranscribeProvider({
      enabled: true,
      apiKey: "test-xi-key",
      fetchFn: mockFetch as any,
    });

    expect(provider.isEnabled()).toBe(true);
    expect(provider.isConfigured()).toBe(true);

    const result = await provider.transcribe({
      audioBuffer: Buffer.from("dummy-audio"),
      mimeType: "audio/wav",
      projectId: "p1",
      audioSourceId: "s1",
      requestedMode: "ELEVENLABS",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("elevenlabs-scribe");
    expect(result.canonicalText).toBe("Yeh zabardast product hai");
    expect(result.wordCount).toBe(4);
    expect(result.durationMs).toBe(1800);
  });
});
