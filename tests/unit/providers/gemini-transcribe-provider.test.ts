import { describe, it, expect, vi } from "vitest";
import { GeminiTranscribeProvider } from "@/providers/transcription/gemini-transcribe.provider";
import { ProviderError } from "@/domain/errors";

describe("GeminiTranscribeProvider — Transport, Cancellation, and Bounded Cleanup", () => {
  const dummyAudio = Buffer.from("RIFF....WAVEfmt ....data....");

  it("aborts the underlying network upload when attempt deadline is exceeded", async () => {
    let capturedUploadSignal: AbortSignal | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("upload/v1beta/files")) {
        capturedUploadSignal = init?.signal as AbortSignal;
        // Simulate a hanging upload that waits for abort signal
        return new Promise<Response>((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: "test-api-key",
      timeoutMs: 50, // 50ms deadline
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      provider.transcribe({
        audioBuffer: dummyAudio,
        mimeType: "audio/wav",
        projectId: "proj-1",
        audioSourceId: "src-1",
        requestedMode: "GEMINI",
      })
    ).rejects.toThrow(ProviderError);

    expect(capturedUploadSignal).toBeDefined();
    expect(capturedUploadSignal?.aborted).toBe(true);
  });

  it("aborts the underlying interactions.create network request when attempt deadline is exceeded", async () => {
    let capturedInteractionSignal: AbortSignal | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("upload/v1beta/files")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/test-file-id",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/test-file-id",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        capturedInteractionSignal = init?.signal as AbortSignal;
        // Simulate a hanging interaction that waits for abort signal
        return new Promise<Response>((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }

      if (urlStr.includes("files/test-file-id") && init?.method === "DELETE") {
        return new Response(JSON.stringify({}), { status: 200 });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: "test-api-key",
      timeoutMs: 50,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      provider.transcribe({
        audioBuffer: dummyAudio,
        mimeType: "audio/wav",
        projectId: "proj-1",
        audioSourceId: "src-1",
        requestedMode: "GEMINI",
      })
    ).rejects.toThrow(ProviderError);

    expect(capturedInteractionSignal).toBeDefined();
    expect(capturedInteractionSignal?.aborted).toBe(true);
  });

  it("executes bounded remote file cleanup in finally after successful upload even if interaction times out", async () => {
    let deleteCallCount = 0;
    let deleteSignal: AbortSignal | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("upload/v1beta/files")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/test-file-cleanup",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/test-file-cleanup",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        return new Promise<Response>((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }

      if (urlStr.includes("files/test-file-cleanup") && init?.method === "DELETE") {
        deleteCallCount++;
        deleteSignal = init?.signal as AbortSignal;
        return new Response(JSON.stringify({}), { status: 200 });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: "test-api-key",
      timeoutMs: 40,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      provider.transcribe({
        audioBuffer: dummyAudio,
        mimeType: "audio/wav",
        projectId: "proj-1",
        audioSourceId: "src-1",
        requestedMode: "GEMINI",
      })
    ).rejects.toThrow(ProviderError);

    expect(deleteCallCount).toBe(1);
    expect(deleteSignal).toBeDefined();
  });

  it("handles cleanup failure / hanging delete safely without masking accepted transcription or hanging indefinitely", async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("upload/v1beta/files")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/test-file-ok",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/test-file-ok",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        return new Response(
          JSON.stringify({
            output_text: "Hello world",
            steps: [
              {
                content: [
                  {
                    annotations: [
                      {
                        type: "word_info",
                        word_info: {
                          word: "Hello",
                          start_offset: "0.000s",
                          end_offset: "0.400s",
                        },
                      },
                      {
                        type: "word_info",
                        word_info: {
                          word: "world",
                          start_offset: "0.450s",
                          end_offset: "0.900s",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("files/test-file-ok") && init?.method === "DELETE") {
        // Cleanup fails with error
        throw new Error("Network error during delete");
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: "test-api-key",
      timeoutMs: 1000,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    // Must still succeed despite cleanup failure!
    const result = await provider.transcribe({
      audioBuffer: dummyAudio,
      mimeType: "audio/wav",
      projectId: "proj-1",
      audioSourceId: "src-1",
      requestedMode: "GEMINI",
    });

    expect(result.canonicalText).toBe("Hello world");
    expect(result.words).toHaveLength(2);
    expect(result.words[0]!.startMs).toBe(0);
    expect(result.words[1]!.endMs).toBe(900);
  });

  it("does not execute a second Gemini attempt after deadline timeout", async () => {
    let interactionCalls = 0;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("upload/v1beta/files")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/test-file-1",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        interactionCalls++;
        return new Promise<Response>((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: "test-api-key",
      timeoutMs: 30,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(
      provider.transcribe({
        audioBuffer: dummyAudio,
        mimeType: "audio/wav",
        projectId: "proj-1",
        audioSourceId: "src-1",
        requestedMode: "GEMINI",
      })
    ).rejects.toThrow();

    // Exactly 1 interaction call was made; no internal retry was attempted
    expect(interactionCalls).toBe(1);
  });
});
