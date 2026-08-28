import { describe, it, expect, vi } from "vitest";
import {
  GeminiTranscribeProvider,
  parseTimestampOffsetToMs,
} from "@/providers/transcription/gemini-transcribe.provider";
import { ProviderError, ValidationError } from "@/domain/errors";

describe("GeminiTranscribeProvider — Official Resumable Transport, Strict word_info & Cancellation", () => {
  const dummyAudio = Buffer.from("RIFF....WAVEfmt ....data....");
  const testApiKey = "AIzaSyTestKey1234567890";

  // =========================================================================
  // 1. Official Resumable Upload Sequence & Header-Only Authentication
  // =========================================================================
  it("executes the full official Gemini resumable upload sequence with header-only authentication", async () => {
    const recordedCalls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const headers = (init?.headers as Record<string, string>) || {};
      recordedCalls.push({
        url: urlStr,
        method: init?.method || "GET",
        headers,
        body: init?.body,
      });

      // Step A: Upload start request
      if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files" && init?.method === "POST") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-abc-123",
          },
        });
      }

      // Step B: Byte upload + finalize request
      if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files/session-abc-123" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/audio-file-uuid",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/audio-file-uuid",
              mimeType: "audio/wav",
            },
          }),
          { status: 200 }
        );
      }

      // Step C: Interactions request
      if (urlStr === "https://generativelanguage.googleapis.com/v1beta/interactions" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            output_text: "Testing official upload",
            steps: [
              {
                content: [
                  {
                    annotations: [
                      {
                        type: "word_info",
                        text: "Testing",
                        start_offset: "0.000s",
                        end_offset: "0.450s",
                      },
                      {
                        type: "word_info",
                        text: "official",
                        start_offset: "0.460s",
                        end_offset: "0.900s",
                      },
                      {
                        type: "word_info",
                        text: "upload",
                        start_offset: "0.910s",
                        end_offset: "1.350s",
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

      // Step D: Bounded remote file cleanup
      if (urlStr === "https://generativelanguage.googleapis.com/v1beta/files/audio-file-uuid" && init?.method === "DELETE") {
        return new Response(JSON.stringify({}), { status: 200 });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: testApiKey,
      timeoutMs: 5000,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.transcribe({
      audioBuffer: dummyAudio,
      mimeType: "audio/wav",
      projectId: "proj-1",
      audioSourceId: "src-1",
      requestedMode: "GEMINI",
    });

    expect(result.canonicalText).toBe("Testing official upload");
    expect(result.words).toHaveLength(3);
    expect(result.words[0]!.startMs).toBe(0);
    expect(result.words[0]!.endMs).toBe(450);
    expect(result.words[2]!.endMs).toBe(1350);

    // Verify exact call count and sequence: Start -> Upload/Finalize -> Interactions -> Cleanup
    expect(recordedCalls).toHaveLength(4);

    // 1. Start Request
    const startCall = recordedCalls[0]!;
    expect(startCall.url).toBe("https://generativelanguage.googleapis.com/upload/v1beta/files");
    expect(startCall.method).toBe("POST");
    expect(startCall.headers["x-goog-api-key"]).toBe(testApiKey);
    expect(startCall.headers["X-Goog-Upload-Protocol"]).toBe("resumable");
    expect(startCall.headers["X-Goog-Upload-Command"]).toBe("start");
    expect(startCall.headers["X-Goog-Upload-Header-Content-Length"]).toBe(String(dummyAudio.byteLength));
    expect(startCall.headers["X-Goog-Upload-Header-Content-Type"]).toBe("audio/wav");
    expect(startCall.headers["Content-Type"]).toBe("application/json");

    // 2. Finalize Request
    const finalizeCall = recordedCalls[1]!;
    expect(finalizeCall.url).toBe("https://generativelanguage.googleapis.com/upload/v1beta/files/session-abc-123");
    expect(finalizeCall.method).toBe("POST");
    expect(finalizeCall.headers["Content-Length"]).toBe(String(dummyAudio.byteLength));
    expect(finalizeCall.headers["X-Goog-Upload-Offset"]).toBe("0");
    expect(finalizeCall.headers["X-Goog-Upload-Command"]).toBe("upload, finalize");
    expect(finalizeCall.body).toBe(dummyAudio);

    // 3. Interactions Request
    const interactionCall = recordedCalls[2]!;
    expect(interactionCall.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(interactionCall.method).toBe("POST");
    expect(interactionCall.headers["x-goog-api-key"]).toBe(testApiKey);
    const interactionBody = JSON.parse(interactionCall.body as string);
    expect(interactionBody.model).toBe("gemini-3.5-transcribe");
    expect(interactionBody.input[0].uri).toBe("https://generativelanguage.googleapis.com/v1beta/files/audio-file-uuid");
    expect(interactionBody.input[0].file_uri).toBeUndefined();
    expect(interactionBody.input[0].mime_type).toBe("audio/wav");
    expect(interactionBody.generation_config.transcription_config.mode.type).toBe("verbatim");

    // 4. Cleanup Request
    const cleanupCall = recordedCalls[3]!;
    expect(cleanupCall.url).toBe("https://generativelanguage.googleapis.com/v1beta/files/audio-file-uuid");
    expect(cleanupCall.method).toBe("DELETE");
    expect(cleanupCall.headers["x-goog-api-key"]).toBe(testApiKey);

    // Assert API key is NEVER in the URL or query string for any call
    for (const call of recordedCalls) {
      expect(call.url).not.toContain(testApiKey);
      expect(call.url).not.toContain("key=");
    }
  });

  // =========================================================================
  // 2. Transport-Level Cancellation / Abort Tests (All Stages)
  // =========================================================================
  it("aborts the underlying network request when upload-start request hangs past deadline", async () => {
    let capturedSignal: AbortSignal | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes("upload/v1beta/files")) {
        capturedSignal = init?.signal as AbortSignal;
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
      apiKey: testApiKey,
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

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("aborts the upload/finalize request when it hangs past deadline after start succeeds", async () => {
    let capturedFinalizeSignal: AbortSignal | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-hang" },
        });
      }

      if (urlStr.includes("session-hang")) {
        capturedFinalizeSignal = init?.signal as AbortSignal;
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
      apiKey: testApiKey,
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

    expect(capturedFinalizeSignal).toBeDefined();
    expect(capturedFinalizeSignal?.aborted).toBe(true);
  });

  it("aborts the interactions.create request when it hangs past deadline after upload succeeds", async () => {
    let capturedInteractionSignal: AbortSignal | undefined;
    let deleteAttempted = false;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-1" },
        });
      }

      if (urlStr.includes("session-1")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/audio-to-clean",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/audio-to-clean",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        capturedInteractionSignal = init?.signal as AbortSignal;
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

      if (urlStr.includes("files/audio-to-clean") && init?.method === "DELETE") {
        deleteAttempted = true;
        return new Response(JSON.stringify({}), { status: 200 });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: testApiKey,
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

    expect(capturedInteractionSignal).toBeDefined();
    expect(capturedInteractionSignal?.aborted).toBe(true);
    expect(deleteAttempted).toBe(true);
  });

  // =========================================================================
  // 3. Genuinely Hanging Cleanup Test
  // =========================================================================
  it("aborts a genuinely hanging remote file cleanup without masking accepted transcription or hanging indefinitely", async () => {
    let capturedCleanupSignal: AbortSignal | undefined;

    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-clean" },
        });
      }

      if (urlStr.includes("session-clean")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/audio-clean-test",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/audio-clean-test",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        return new Response(
          JSON.stringify({
            output_text: "Accepted transcription",
            steps: [
              {
                content: [
                  {
                    annotations: [
                      {
                        type: "word_info",
                        text: "Accepted",
                        start_offset: "0.000s",
                        end_offset: "0.500s",
                      },
                      {
                        type: "word_info",
                        text: "transcription",
                        start_offset: "0.510s",
                        end_offset: "1.100s",
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

      if (urlStr.includes("files/audio-clean-test") && init?.method === "DELETE") {
        capturedCleanupSignal = init?.signal as AbortSignal;
        // Genuinely hanging Promise that waits until the cleanup signal is aborted
        return new Promise<Response>((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener("abort", () => {
              const abortErr = new Error("Cleanup timed out");
              abortErr.name = "AbortError";
              reject(abortErr);
            });
          }
        });
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: testApiKey,
      timeoutMs: 2000,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.transcribe({
      audioBuffer: dummyAudio,
      mimeType: "audio/wav",
      projectId: "proj-1",
      audioSourceId: "src-1",
      requestedMode: "GEMINI",
    });

    // Transcription succeeds despite hanging delete
    expect(result.canonicalText).toBe("Accepted transcription");
    expect(result.words).toHaveLength(2);
    expect(capturedCleanupSignal).toBeDefined();
  });

  // =========================================================================
  // 4. Strict Authoritative word_info Parsing & Negative Tests
  // =========================================================================
  it("strictly accepts ONLY direct annotation.type === 'word_info' and ignores all loose / untyped shapes", async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-strict" },
        });
      }

      if (urlStr.includes("session-strict")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/audio-strict",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/audio-strict",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        return new Response(
          JSON.stringify({
            output_text: "Valid strict word",
            steps: [
              {
                content: [
                  {
                    annotations: [
                      // 1. Ignored: word object wrapper
                      {
                        word: {
                          text: "ignored_word_wrap",
                          start_offset: "0.000s",
                          end_offset: "0.100s",
                        },
                      },
                      // 2. Ignored: word_info object wrapper
                      {
                        word_info: {
                          text: "ignored_info_wrap",
                          start_offset: "0.100s",
                          end_offset: "0.200s",
                        },
                      },
                      // 3. Ignored: annotation_type alias
                      {
                        annotation_type: "word_info",
                        text: "ignored_annotation_type",
                        start_offset: "0.200s",
                        end_offset: "0.300s",
                      },
                      // 4. Ignored: other type
                      {
                        type: "speaker_turn",
                        text: "ignored_turn",
                        start_offset: "0.300s",
                        end_offset: "0.400s",
                      },
                      // 5. AUTHORITATIVE: strict type === "word_info"
                      {
                        type: "word_info",
                        text: "Valid",
                        start_offset: "0.000s",
                        end_offset: "0.400s",
                      },
                      {
                        type: "word_info",
                        text: "strict",
                        start_offset: "0.410s",
                        end_offset: "0.800s",
                      },
                      {
                        type: "word_info",
                        text: "word",
                        start_offset: "0.810s",
                        end_offset: "1.200s",
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

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: testApiKey,
      timeoutMs: 2000,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await provider.transcribe({
      audioBuffer: dummyAudio,
      mimeType: "audio/wav",
      projectId: "proj-1",
      audioSourceId: "src-1",
      requestedMode: "GEMINI",
    });

    expect(result.canonicalText).toBe("Valid strict word");
    expect(result.words).toHaveLength(3);
    expect(result.words.map((w) => w.text)).toEqual(["Valid", "strict", "word"]);
  });

  it("throws MISSING_TIMESTAMPS when interaction has display text but zero valid strict word_info annotations", async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-missing" },
        });
      }

      if (urlStr.includes("session-missing")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/audio-missing",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/audio-missing",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        return new Response(
          JSON.stringify({
            output_text: "Some text without word_info",
            steps: [
              {
                content: [
                  {
                    // Only untyped annotations
                    annotations: [
                      {
                        annotation_type: "word_info",
                        text: "Untyped",
                        start_offset: "0s",
                        end_offset: "1s",
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

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: testApiKey,
      timeoutMs: 2000,
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
  });

  // =========================================================================
  // 5. Strict Duration String Validation & Deterministic Offset Conversion
  // =========================================================================
  describe("parseTimestampOffsetToMs — Strict Duration Parsing Matrix", () => {
    it("correctly and deterministically converts valid duration strings to integer milliseconds", () => {
      expect(parseTimestampOffsetToMs("0s")).toBe(0);
      expect(parseTimestampOffsetToMs("0.0s")).toBe(0);
      expect(parseTimestampOffsetToMs("0.100s")).toBe(100);
      expect(parseTimestampOffsetToMs("1.250s")).toBe(1250);
      expect(parseTimestampOffsetToMs("62.003s")).toBe(62003);
      expect(parseTimestampOffsetToMs("120s")).toBe(120000);
    });

    it("rejects all malformed, prefixed, suffixed, negative, exponent, or whitespace-padded duration strings", () => {
      const malformedInputs = [
        "1.25seconds",
        "1.25garbage",
        "-1s",
        "+1s",
        "1..25s",
        ".25s",
        "1.2.3s",
        "NaNs",
        "Infinitys",
        "-Infinitys",
        "1e3s",
        "1 s",
        " 1s",
        "1s ",
        "s",
        "",
        "1",
        "1.25",
        null,
        undefined,
        123,
        {},
        [],
      ];

      for (const input of malformedInputs) {
        expect(parseTimestampOffsetToMs(input)).toBeNull();
      }
    });
  });

  it("fails closed with ValidationError when interaction contains end_offset < start_offset", async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-bad" },
        });
      }

      if (urlStr.includes("session-bad")) {
        return new Response(
          JSON.stringify({
            file: {
              name: "files/audio-bad",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/audio-bad",
            },
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("v1beta/interactions")) {
        return new Response(
          JSON.stringify({
            output_text: "Bad timestamps",
            steps: [
              {
                content: [
                  {
                    annotations: [
                      {
                        type: "word_info",
                        text: "Bad",
                        start_offset: "1.500s",
                        end_offset: "0.500s", // end < start!
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

      return new Response(JSON.stringify({}), { status: 200 });
    });

    const provider = new GeminiTranscribeProvider({
      apiKey: testApiKey,
      timeoutMs: 2000,
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
  });

  // =========================================================================
  // 6. Strict Finalized File Response Validation & Negative Tests
  // =========================================================================
  describe("Finalized File Response Validation", () => {
    it("rejects finalized response with top-level uri/name and missing 'file' wrapper (fails closed without calling interactions)", async () => {
      let interactionsCalled = false;

      const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-top-level" },
          });
        }

        if (urlStr.includes("session-top-level")) {
          // Undocumented / top-level alias shape: missing `file` wrapper!
          return new Response(
            JSON.stringify({
              name: "files/audio-top-level",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/audio-top-level",
            }),
            { status: 200 }
          );
        }

        if (urlStr.includes("v1beta/interactions")) {
          interactionsCalled = true;
          return new Response(JSON.stringify({}), { status: 200 });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      });

      const provider = new GeminiTranscribeProvider({
        apiKey: testApiKey,
        timeoutMs: 2000,
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

      expect(interactionsCalled).toBe(false);
    });

    it("rejects finalized response when file.uri is missing", async () => {
      let interactionsCalled = false;

      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-no-uri" },
          });
        }

        if (urlStr.includes("session-no-uri")) {
          return new Response(
            JSON.stringify({
              file: {
                name: "files/audio-no-uri",
              },
            }),
            { status: 200 }
          );
        }

        if (urlStr.includes("v1beta/interactions")) {
          interactionsCalled = true;
          return new Response(JSON.stringify({}), { status: 200 });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      });

      const provider = new GeminiTranscribeProvider({
        apiKey: testApiKey,
        timeoutMs: 2000,
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

      expect(interactionsCalled).toBe(false);
    });

    it("rejects finalized response when file.name is missing", async () => {
      let interactionsCalled = false;

      const mockFetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr === "https://generativelanguage.googleapis.com/upload/v1beta/files") {
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/v1beta/files/session-no-name" },
          });
        }

        if (urlStr.includes("session-no-name")) {
          return new Response(
            JSON.stringify({
              file: {
                uri: "https://generativelanguage.googleapis.com/v1beta/files/audio-no-name",
              },
            }),
            { status: 200 }
          );
        }

        if (urlStr.includes("v1beta/interactions")) {
          interactionsCalled = true;
          return new Response(JSON.stringify({}), { status: 200 });
        }

        return new Response(JSON.stringify({}), { status: 200 });
      });

      const provider = new GeminiTranscribeProvider({
        apiKey: testApiKey,
        timeoutMs: 2000,
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

      expect(interactionsCalled).toBe(false);
    });
  });
});
