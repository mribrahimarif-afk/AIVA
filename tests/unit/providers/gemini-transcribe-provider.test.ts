import { describe, it, expect, vi } from "vitest";
import { GeminiTranscribeProvider } from "@/providers/transcription/gemini-transcribe.provider";
import { ProviderError } from "@/domain/errors";

describe("GeminiTranscribeProvider Unit & Error Handling Tests (TASK-004B)", () => {
  it("reports unconfigured when API key is missing", () => {
    const provider = new GeminiTranscribeProvider({ apiKey: "" });
    expect(provider.isConfigured()).toBe(false);
  });

  it("successfully parses official Gemini 3.5 interaction with steps, content, word_info annotations, and duration strings", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({
      name: "files/test-interaction-123",
      uri: "https://generativelanguage.googleapis.com/v1beta/files/test-interaction-123",
      mimeType: "audio/wav",
    });

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
                  type: "other_info", // Ignored non-word annotation
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
    expect(deleteSpy).toHaveBeenCalledTimes(1);
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
    expect(result.words[1]).toMatchObject({
      sequence: 2,
      text: "Studio",
      startMs: 500,
      endMs: 900,
      sourceStart: 5,
      sourceEnd: 11,
      speaker: "Speaker 1",
    });
    expect(result.words[4]).toMatchObject({
      sequence: 5,
      text: "today",
      startMs: 1850,
      endMs: 62003,
      sourceStart: 23,
      sourceEnd: 28,
    });
  });

  it("fails closed with MALFORMED_RESPONSE on missing start_offset or end_offset", async () => {
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
                  // missing end_offset
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

  it("fails closed with MALFORMED_RESPONSE when end_offset < start_offset", async () => {
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

  it("fails closed with MISSING_TIMESTAMPS when non-empty text has zero word_info annotations", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/test-missing" });
    const createInteractionSpy = vi.fn().mockResolvedValue({
      output_text: "Some transcript text without any annotations",
      steps: [
        {
          content: [
            {
              annotations: [],
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
      details: { code: "MISSING_TIMESTAMPS" },
    });
  });

  it("handles valid NO_SPEECH cleanly", async () => {
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

  it("cleans up remote file in finally on error", async () => {
    const deleteSpy = vi.fn().mockResolvedValue({});
    const uploadSpy = vi.fn().mockResolvedValue({ name: "files/err-file" });
    const createInteractionSpy = vi.fn().mockRejectedValue({
      status: 429,
      message: "Quota exceeded",
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
    ).rejects.toThrow(ProviderError);

    expect(deleteSpy).toHaveBeenCalledWith({ name: "files/err-file" });
  });
});

