import { describe, it, expect, vi } from "vitest";
import { GeminiTranscribeProvider } from "@/providers/transcription/gemini-transcribe.provider";
import { ProviderError } from "@/domain/errors";

describe("GeminiTranscribeProvider Unit & Error Handling Tests (TASK-004B)", () => {
  it("reports unconfigured when API key is missing", () => {
    const provider = new GeminiTranscribeProvider({ apiKey: "" });
    expect(provider.isConfigured()).toBe(false);
  });

  it("1. uses interactions.create with verbatim and word granularities, never calls generateContent", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({
      name: "files/test-interaction-123",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/test-interaction-123",
      mimeType: "audio/wav",
    });
    const generateContentSpy = vi.fn();

    const officialInteractionResponse = {
      output_text: "AIVA Studio is awesome today",
      language: "en-US",
      steps: [
        {
          content: [
            {
              type: "text",
              text: "AIVA Studio",
              annotations: [
                {
                  type: "word_info",
                  text: "AIVA",
                  start_offset: "0.100s",
                  end_offset: "0.450s",
                  speaker: "Speaker 1",
                },
                {
                  type: "other_info",
                  data: "ignore_me",
                },
                {
                  type: "word_info",
                  text: "Studio",
                  start_offset: "0.500s",
                  end_offset: "0.900s",
                  speaker: "Speaker 1",
                },
              ],
            },
          ],
        },
        {
          content: [
            {
              type: "text",
              text: "is awesome today",
              annotations: [
                {
                  type: "word_info",
                  text: "is",
                  start_offset: "0.950s",
                  end_offset: "1.100s",
                },
                {
                  type: "word_info",
                  text: "awesome",
                  start_offset: "1.250s",
                  end_offset: "1.800s",
                },
                {
                  type: "word_info",
                  text: "today",
                  start_offset: "1.850s",
                  end_offset: "62.003s",
                },
              ],
            },
          ],
        },
      ],
    };

    const createInteractionSpy = vi.fn().mockResolvedValue(officialInteractionResponse);

    const mockGenAiClient: any = {
      files: {
        upload: uploadSpy,
        delete: deleteSpy,
      },
      models: {
        generateContent: generateContentSpy,
      },
      interactions: {
        create: createInteractionSpy,
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
    expect(createInteractionSpy).toHaveBeenCalledTimes(1);
    expect(generateContentSpy).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledWith({ name: "files/test-interaction-123" });

    expect(result.provider).toBe("gemini-transcribe");
    expect(result.displayText).toBe("AIVA Studio is awesome today");
    expect(result.canonicalText).toBe("AIVA Studio is awesome today");
    expect(result.wordCount).toBe(5);
    expect(result.durationMs).toBe(62003);

    expect(result.words[0]).toMatchObject({
      sequence: 1,
      text: "AIVA",
      startMs: 100,
      endMs: 450,
      sourceStart: 0,
      sourceEnd: 4,
      speaker: "Speaker 1",
    });
  });

  it("2. ignores/rejects top-level response.words without word_info annotations", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/test-words-prop" });
    const createInteractionSpy = vi.fn().mockResolvedValue({
      output_text: "Top level words without annotations",
      words: [{ text: "Top", start: 0, end: 100 }],
      steps: [], // No valid steps/content annotations
    });

    const mockGenAiClient: any = {
      files: { upload: uploadSpy, delete: deleteSpy },
      interactions: { create: createInteractionSpy },
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

  it("3. fails closed with MALFORMED_RESPONSE on missing start_offset or end_offset", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/test-malformed" });
    const createInteractionSpy = vi.fn().mockResolvedValue({
      output_text: "Hello",
      steps: [
        {
          content: [
            {
              annotations: [
                {
                  type: "word_info",
                  text: "Hello",
                  start_offset: "0.100s",
                },
              ],
            },
          ],
        },
      ],
    });

    const mockGenAiClient: any = {
      files: { upload: uploadSpy, delete: deleteSpy },
      interactions: { create: createInteractionSpy },
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
      details: { code: "MALFORMED_RESPONSE" },
    });
  });

  it("4. fails closed with MALFORMED_RESPONSE when end_offset < start_offset", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/test-inverted" });
    const createInteractionSpy = vi.fn().mockResolvedValue({
      output_text: "Hello",
      steps: [
        {
          content: [
            {
              annotations: [
                {
                  type: "word_info",
                  text: "Hello",
                  start_offset: "1.000s",
                  end_offset: "0.500s",
                },
              ],
            },
          ],
        },
      ],
    });

    const mockGenAiClient: any = {
      files: { upload: uploadSpy, delete: deleteSpy },
      interactions: { create: createInteractionSpy },
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
      details: { code: "MALFORMED_RESPONSE" },
    });
  });

  it("5. bounds entire attempt with timeout and cleans up remote file", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/test-timeout" });
    const createInteractionSpy = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 5000))
    );

    const mockGenAiClient: any = {
      files: { upload: uploadSpy, delete: deleteSpy },
      interactions: { create: createInteractionSpy },
    };

    const provider = new GeminiTranscribeProvider({
      apiKey: "AIzaSyTestKey",
      timeoutMs: 50, // very small timeout to trigger abort
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
      details: { code: "TIMEOUT" },
    });

    expect(deleteSpy).toHaveBeenCalledWith({ name: "files/test-timeout" });
  });

  it("6. sanitizes sensitive API keys and absolute file paths in provider error messages", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockRejectedValue(
      new Error("Upload failed for C:\\Users\\secret\\audio.wav with api_key: AIzaSySecretKey1234567890")
    );

    const mockGenAiClient: any = {
      files: { upload: uploadSpy, delete: deleteSpy },
      interactions: { create: vi.fn() },
    };

    const provider = new GeminiTranscribeProvider({
      apiKey: "AIzaSySecretKey1234567890",
      genAiClient: mockGenAiClient,
    });

    try {
      await provider.transcribe({
        audioBuffer: Buffer.from("dummy-audio"),
        mimeType: "audio/wav",
        projectId: "proj-1",
        audioSourceId: "src-1",
        requestedMode: "GEMINI",
      });
      expect.fail("Should have thrown ProviderError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ProviderError);
      expect(err.message).not.toContain("AIzaSySecretKey1234567890");
      expect(err.message).not.toContain("C:\\Users\\secret\\audio.wav");
      expect(err.message).toContain("[REDACTED]");
    }
  });

  it("7. handles valid NO_SPEECH cleanly", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/silent-1" });
    const createInteractionSpy = vi.fn().mockResolvedValue({
      output_text: "",
      noSpeech: true,
      steps: [],
    });

    const mockGenAiClient: any = {
      files: { upload: uploadSpy, delete: deleteSpy },
      interactions: { create: createInteractionSpy },
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
});
