import { describe, it, expect, vi } from "vitest";
import { ResilientTranscribeProvider } from "@/providers/transcription/resilient-transcribe.provider";
import { ProviderError, ValidationError } from "@/domain/errors";
import type { TranscriptionResult } from "@/domain/transcription";

describe("ResilientTranscribeProvider Routing & Fallback Tests (TASK-004B)", () => {
  const dummyInput = {
    audioBuffer: Buffer.from("dummy-wav"),
    mimeType: "audio/wav",
    projectId: "p1",
    audioSourceId: "s1",
    requestedMode: "AUTO" as const,
  };

  const sampleResult: TranscriptionResult = {
    provider: "gemini-transcribe",
    model: "gemini-3.5-transcribe",
    requestedMode: "AUTO",
    displayText: "Test transcript",
    canonicalText: "Test transcript",
    durationMs: 1000,
    wordCount: 2,
    words: [
      { sequence: 1, text: "Test", startMs: 0, endMs: 400, sourceStart: 0, sourceEnd: 4 },
      { sequence: 2, text: "transcript", startMs: 450, endMs: 1000, sourceStart: 5, sourceEnd: 15 },
    ],
  };

  const azureSampleResult: TranscriptionResult = {
    provider: "azure-speech-stt",
    model: "azure-speech-continuous-stt",
    requestedMode: "AUTO",
    displayText: "Azure transcript",
    canonicalText: "Azure transcript",
    durationMs: 1000,
    wordCount: 2,
    words: [
      { sequence: 1, text: "Azure", startMs: 0, endMs: 400, sourceStart: 0, sourceEnd: 5 },
      { sequence: 2, text: "transcript", startMs: 450, endMs: 1000, sourceStart: 6, sourceEnd: 16 },
    ],
  };

  it("AUTO mode: Gemini success does NOT call Azure", async () => {
    const geminiMock: any = {
      id: "gemini-transcribe",
      modelName: "gemini-3.5-transcribe",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue(sampleResult),
    };
    const azureMock: any = {
      id: "azure-speech-stt",
      modelName: "azure-speech-continuous-stt",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue(azureSampleResult),
    };

    const router = new ResilientTranscribeProvider({
      geminiProvider: geminiMock,
      azureProvider: azureMock,
    });

    const result = await router.transcribe(dummyInput);
    expect(geminiMock.transcribe).toHaveBeenCalledTimes(1);
    expect(azureMock.transcribe).not.toHaveBeenCalled();
    expect(result.provider).toBe("gemini-transcribe");
  });

  it("AUTO mode: Gemini 429 triggers Azure fallback once", async () => {
    const geminiMock: any = {
      id: "gemini-transcribe",
      modelName: "gemini-3.5-transcribe",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockRejectedValue(
        new ProviderError("gemini-transcribe", "Rate limited", { code: "RATE_LIMITED" })
      ),
    };
    const azureMock: any = {
      id: "azure-speech-stt",
      modelName: "azure-speech-continuous-stt",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue(azureSampleResult),
    };

    const router = new ResilientTranscribeProvider({
      geminiProvider: geminiMock,
      azureProvider: azureMock,
    });

    const result = await router.transcribe(dummyInput);
    expect(geminiMock.transcribe).toHaveBeenCalledTimes(1);
    expect(azureMock.transcribe).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("azure-speech-stt");
    expect(result.requestedMode).toBe("AUTO");
  });

  it("AUTO mode: Gemini timeout triggers Azure fallback once", async () => {
    const geminiMock: any = {
      id: "gemini-transcribe",
      modelName: "gemini-3.5-transcribe",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockRejectedValue(
        new ProviderError("gemini-transcribe", "Timeout", { code: "TIMEOUT" })
      ),
    };
    const azureMock: any = {
      id: "azure-speech-stt",
      modelName: "azure-speech-continuous-stt",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue(azureSampleResult),
    };

    const router = new ResilientTranscribeProvider({
      geminiProvider: geminiMock,
      azureProvider: azureMock,
    });

    const result = await router.transcribe(dummyInput);
    expect(geminiMock.transcribe).toHaveBeenCalledTimes(1);
    expect(azureMock.transcribe).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("azure-speech-stt");
  });

  it("AUTO mode: Gemini missing timestamps triggers Azure fallback once", async () => {
    const geminiMock: any = {
      id: "gemini-transcribe",
      modelName: "gemini-3.5-transcribe",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockRejectedValue(
        new ProviderError("gemini-transcribe", "Missing timestamps", { code: "MISSING_TIMESTAMPS" })
      ),
    };
    const azureMock: any = {
      id: "azure-speech-stt",
      modelName: "azure-speech-continuous-stt",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue(azureSampleResult),
    };

    const router = new ResilientTranscribeProvider({
      geminiProvider: geminiMock,
      azureProvider: azureMock,
    });

    const result = await router.transcribe(dummyInput);
    expect(geminiMock.transcribe).toHaveBeenCalledTimes(1);
    expect(azureMock.transcribe).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("azure-speech-stt");
  });

  it("AUTO mode: unconfigured Gemini routes directly to Azure without invoking Gemini", async () => {
    const geminiMock: any = {
      id: "gemini-transcribe",
      modelName: "gemini-3.5-transcribe",
      isConfigured: vi.fn().mockReturnValue(false),
      transcribe: vi.fn(),
    };
    const azureMock: any = {
      id: "azure-speech-stt",
      modelName: "azure-speech-continuous-stt",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue(azureSampleResult),
    };

    const router = new ResilientTranscribeProvider({
      geminiProvider: geminiMock,
      azureProvider: azureMock,
    });

    const result = await router.transcribe(dummyInput);
    expect(geminiMock.transcribe).not.toHaveBeenCalled();
    expect(azureMock.transcribe).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("azure-speech-stt");
  });

  it("GEMINI mode failure does NOT call Azure", async () => {
    const geminiMock: any = {
      id: "gemini-transcribe",
      modelName: "gemini-3.5-transcribe",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockRejectedValue(
        new ProviderError("gemini-transcribe", "Error", { code: "UPSTREAM_UNAVAILABLE" })
      ),
    };
    const azureMock: any = {
      id: "azure-speech-stt",
      modelName: "azure-speech-continuous-stt",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn(),
    };

    const router = new ResilientTranscribeProvider({
      geminiProvider: geminiMock,
      azureProvider: azureMock,
    });

    await expect(router.transcribe({ ...dummyInput, requestedMode: "GEMINI" })).rejects.toThrow(
      ProviderError
    );
    expect(geminiMock.transcribe).toHaveBeenCalledTimes(1);
    expect(azureMock.transcribe).not.toHaveBeenCalled();
  });

  it("AZURE mode does NOT call Gemini", async () => {
    const geminiMock: any = {
      id: "gemini-transcribe",
      modelName: "gemini-3.5-transcribe",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn(),
    };
    const azureMock: any = {
      id: "azure-speech-stt",
      modelName: "azure-speech-continuous-stt",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue(azureSampleResult),
    };

    const router = new ResilientTranscribeProvider({
      geminiProvider: geminiMock,
      azureProvider: azureMock,
    });

    const result = await router.transcribe({ ...dummyInput, requestedMode: "AZURE" });
    expect(geminiMock.transcribe).not.toHaveBeenCalled();
    expect(azureMock.transcribe).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("azure-speech-stt");
  });

  it("ELEVENLABS mode calls only ElevenLabs provider", async () => {
    const geminiMock: any = { id: "gemini-transcribe", isConfigured: vi.fn() };
    const azureMock: any = { id: "azure-speech-stt", isConfigured: vi.fn() };
    const elevenLabsMock: any = {
      id: "elevenlabs-scribe",
      modelName: "scribe_v2",
      isConfigured: vi.fn().mockReturnValue(true),
      transcribe: vi.fn().mockResolvedValue({
        provider: "elevenlabs-scribe",
        model: "scribe_v2",
        requestedMode: "ELEVENLABS",
        displayText: "ElevenLabs text",
        canonicalText: "ElevenLabs text",
        durationMs: 1000,
        wordCount: 2,
        words: [],
      }),
    };

    const router = new ResilientTranscribeProvider({
      geminiProvider: geminiMock,
      azureProvider: azureMock,
      elevenLabsProvider: elevenLabsMock,
    });

    const result = await router.transcribe({ ...dummyInput, requestedMode: "ELEVENLABS" });
    expect(elevenLabsMock.transcribe).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("elevenlabs-scribe");
  });
});
