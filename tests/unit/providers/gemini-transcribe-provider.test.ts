import { describe, it, expect, vi } from "vitest";
import { GeminiTranscribeProvider } from "@/providers/transcription/gemini-transcribe.provider";
import { ProviderError } from "@/domain/errors";

describe("GeminiTranscribeProvider Unit & Error Handling Tests (TASK-004B)", () => {
  it("reports unconfigured when API key is missing", () => {
    const provider = new GeminiTranscribeProvider({ apiKey: "" });
    expect(provider.isConfigured()).toBe(false);
  });

  it("successfully transcribes audio with verbatim word timestamps and cleans up remote file", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({
      name: "files/test-file-123",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/test-file-123",
      mimeType: "audio/wav",
    });
    const generateContentSpy = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        text: "AIVA Studio is awesome",
        language: "en-US",
        words: [
          { text: "AIVA", start: 0.0, end: 0.4 },
          { text: "Studio", start: 0.45, end: 0.9 },
          { text: "is", start: 0.95, end: 1.1 },
          { text: "awesome", start: 1.15, end: 1.8 },
        ],
      }),
    });

    const mockGenAiClient: any = {
      files: {
        upload: uploadSpy,
        delete: deleteSpy,
      },
      models: {
        generateContent: generateContentSpy,
      },
    };

    const provider = new GeminiTranscribeProvider({
      apiKey: "AIzaSyTestKey_Secret",
      genAiClient: mockGenAiClient,
    });

    const result = await provider.transcribe({
      audioBuffer: Buffer.from("dummy-audio-bytes"),
      mimeType: "audio/wav",
      projectId: "proj-1",
      audioSourceId: "src-1",
      requestedMode: "GEMINI",
    });

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(generateContentSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith({ name: "files/test-file-123" });

    expect(result.provider).toBe("gemini-transcribe");
    expect(result.canonicalText).toBe("AIVA Studio is awesome");
    expect(result.wordCount).toBe(4);
    expect(result.durationMs).toBe(1800);
    expect(result.words[0]).toMatchObject({ sequence: 1, text: "AIVA", startMs: 0, endMs: 400 });
  });

  it("attempts remote file cleanup in finally even when transcription generation throws", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({
      name: "files/test-file-error-456",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/test-file-error-456",
    });
    const generateContentSpy = vi.fn().mockRejectedValue({
      status: 429,
      message: "Resource has been exhausted (quota)",
    });

    const mockGenAiClient: any = {
      files: {
        upload: uploadSpy,
        delete: deleteSpy,
      },
      models: {
        generateContent: generateContentSpy,
      },
    };

    const provider = new GeminiTranscribeProvider({
      apiKey: "AIzaSyTestKey_Secret",
      genAiClient: mockGenAiClient,
    });

    await expect(
      provider.transcribe({
        audioBuffer: Buffer.from("dummy-audio-bytes"),
        mimeType: "audio/wav",
        projectId: "proj-1",
        audioSourceId: "src-1",
        requestedMode: "GEMINI",
      })
    ).rejects.toThrow(ProviderError);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith({ name: "files/test-file-error-456" });
  });

  it("handles valid NO_SPEECH response cleanly", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/silent-1" });
    const generateContentSpy = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        text: "",
        noSpeech: true,
        words: [],
      }),
    });

    const mockGenAiClient: any = {
      files: { upload: uploadSpy, delete: deleteSpy },
      models: { generateContent: generateContentSpy },
    };

    const provider = new GeminiTranscribeProvider({
      apiKey: "AIzaSyTestKey",
      genAiClient: mockGenAiClient,
    });

    const result = await provider.transcribe({
      audioBuffer: Buffer.from("silent-audio"),
      mimeType: "audio/wav",
      projectId: "proj-1",
      audioSourceId: "src-1",
      requestedMode: "GEMINI",
    });

    expect(result.noSpeech).toBe(true);
    expect(result.wordCount).toBe(0);
    expect(result.canonicalText).toBe("");
  });

  it("throws ProviderError with code MISSING_TIMESTAMPS when text exists without word annotations", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/missing-ts" });
    const generateContentSpy = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        text: "Some text without timestamps",
        words: [],
      }),
    });

    const mockGenAiClient: any = {
      files: { upload: uploadSpy, delete: deleteSpy },
      models: { generateContent: generateContentSpy },
    };

    const provider = new GeminiTranscribeProvider({
      apiKey: "AIzaSyTestKey",
      genAiClient: mockGenAiClient,
    });

    await expect(
      provider.transcribe({
        audioBuffer: Buffer.from("dummy-audio"),
        mimeType: "audio/wav",
        projectId: "proj-1",
        audioSourceId: "src-1",
        requestedMode: "GEMINI",
      })
    ).rejects.toMatchObject({
      details: { code: "MISSING_TIMESTAMPS" },
    });
  });
});
