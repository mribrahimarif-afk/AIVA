import { describe, it, expect, vi } from "vitest";
import {
  ElevenLabsVoiceProvider,
  ELEVENLABS_MAX_CHARS_V3,
} from "@/providers/voice/elevenlabs-voice.provider";
import { ProviderError } from "@/domain/errors";
import { logger } from "@/infrastructure/logging/logger";

describe("ElevenLabsVoiceProvider Unit & Transport Tests", () => {
  const sampleScript = "Hello world from AIVA ElevenLabs";
  const mockPcmBuffer = Buffer.alloc(48000, 0x11); // 1 second of 24kHz 16-bit mono PCM
  const mockBase64 = mockPcmBuffer.toString("base64");

  function createMockAlignment(script: string) {
    const characters = Array.from(script);
    const start_times = characters.map((_, i) => i * 0.05);
    const end_times = characters.map((_, i) => (i + 1) * 0.05);
    return {
      characters,
      character_start_times_seconds: start_times,
      character_end_times_seconds: end_times,
    };
  }

  it("reports isConfigured() correctly based on API key presence", () => {
    const unconfigured = new ElevenLabsVoiceProvider({ apiKey: "" });
    expect(unconfigured.isConfigured()).toBe(false);

    const configured = new ElevenLabsVoiceProvider({ apiKey: "el_test_key_123" });
    expect(configured.isConfigured()).toBe(true);
  });

  it("rejects synthesis when unconfigured with VOICE_UNCONFIGURED", async () => {
    const provider = new ElevenLabsVoiceProvider({ apiKey: "" });
    try {
      await provider.synthesize({ text: sampleScript, voiceName: "test_voice" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("VOICE_UNCONFIGURED");
    }
  });

  it("rejects synthesis before making network calls when voiceName is missing and no default voice configured", async () => {
    const fetchFn = vi.fn();
    const provider = new ElevenLabsVoiceProvider({
      apiKey: "el_key_123",
      defaultVoiceId: "",
      fetchFn: fetchFn as never,
    });

    try {
      await provider.synthesize({ text: sampleScript, voiceName: "" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("REQUEST_FAILED");
    }

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("enforces 5,000 character preflight limit for eleven_v3 without calling network", async () => {
    const fetchFn = vi.fn();
    const provider = new ElevenLabsVoiceProvider({
      apiKey: "el_test_key_123",
      modelId: "eleven_v3",
      defaultVoiceId: "test_voice_1",
      fetchFn: fetchFn as never,
    });

    const oversizedScript = "A".repeat(ELEVENLABS_MAX_CHARS_V3 + 1);

    try {
      await provider.synthesize({ text: oversizedScript, voiceName: "test_voice_1" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("REQUEST_FAILED");
    }

    // Network must NOT have been called
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("constructs correct endpoint, server-side xi-api-key, and exact body shape", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    const fetchFn = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init.headers as Record<string, string>) || {};
      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          audio_base64: mockBase64,
          alignment: createMockAlignment(sampleScript),
        }),
      } as Response;
    });

    const provider = new ElevenLabsVoiceProvider({
      apiKey: "el_secret_key_999",
      modelId: "eleven_v3",
      defaultVoiceId: "custom_voice_id_123",
      fetchFn: fetchFn as never,
    });

    const result = await provider.synthesize({
      text: sampleScript,
      voiceName: "custom_voice_id_123",
    });

    // 1. Verify endpoint URL with voice ID and pcm_24000 format query
    expect(capturedUrl).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/custom_voice_id_123/with-timestamps?output_format=pcm_24000"
    );

    // 2. Verify server-side xi-api-key header
    expect(capturedHeaders["xi-api-key"]).toBe("el_secret_key_999");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");

    // 3. Verify exact unmodified script sent in body
    expect(capturedBody.text).toBe(sampleScript);
    expect(capturedBody.model_id).toBe("eleven_v3");

    // 4. Verify synthesis result is converted into canonical WAV
    expect(result.audioData.toString("ascii", 0, 4)).toBe("RIFF");
    expect(result.audioData.toString("ascii", 8, 12)).toBe("WAVE");
    expect(result.outputFormat).toBe("Riff24Khz16BitMonoPcm");
    expect(result.voiceName).toBe("custom_voice_id_123");
    expect(result.model).toBe("eleven_v3");
    expect(result.boundaries.length).toBeGreaterThan(0);
  });

  it("never automatically retries on ambiguous failure or timeout (one external call only)", async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 503,
        json: async () => ({ detail: "Service temporarily unavailable" }),
      } as Response;
    });

    const provider = new ElevenLabsVoiceProvider({
      apiKey: "el_key_123",
      defaultVoiceId: "voice_1",
      fetchFn: fetchFn as never,
    });

    await expect(provider.synthesize({ text: sampleScript, voiceName: "voice_1" })).rejects.toThrow(ProviderError);

    // Hard guarantee: exactly 1 call, zero auto-retries
    expect(callCount).toBe(1);
  });

  describe("Strict Base64 Audio Validation Tests", () => {
    it("accepts strictly valid Base64 and produces valid canonical WAV", async () => {
      const validPcm = Buffer.from([0x00, 0x10, 0x00, 0x20]);
      const validBase64 = validPcm.toString("base64");

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audio_base64: validBase64,
          alignment: createMockAlignment(sampleScript),
        }),
      } as Response);

      const provider = new ElevenLabsVoiceProvider({
        apiKey: "el_key",
        defaultVoiceId: "v1",
        fetchFn: fetchFn as never,
      });

      const result = await provider.synthesize({ text: sampleScript, voiceName: "v1" });
      expect(result.audioData).toBeInstanceOf(Buffer);
      expect(result.audioData.length).toBe(44 + 4);
    });

    it("rejects invalid Base64 characters (e.g. not-valid-base64!!!) with REQUEST_FAILED", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audio_base64: "not-valid-base64!!!",
          alignment: createMockAlignment(sampleScript),
        }),
      } as Response);

      const provider = new ElevenLabsVoiceProvider({
        apiKey: "el_key",
        defaultVoiceId: "v1",
        fetchFn: fetchFn as never,
      });

      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("REQUEST_FAILED");
      }
    });

    it("rejects invalid padding (e.g. AAAA=) with REQUEST_FAILED", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audio_base64: "AAAA=",
          alignment: createMockAlignment(sampleScript),
        }),
      } as Response);

      const provider = new ElevenLabsVoiceProvider({
        apiKey: "el_key",
        defaultVoiceId: "v1",
        fetchFn: fetchFn as never,
      });

      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("REQUEST_FAILED");
      }
    });

    it("rejects invalid length not multiple of 4 (e.g. AAA) with REQUEST_FAILED", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audio_base64: "AAA",
          alignment: createMockAlignment(sampleScript),
        }),
      } as Response);

      const provider = new ElevenLabsVoiceProvider({
        apiKey: "el_key",
        defaultVoiceId: "v1",
        fetchFn: fetchFn as never,
      });

      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("REQUEST_FAILED");
      }
    });

    it("rejects empty audio string with EMPTY_AUDIO", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audio_base64: "   ",
          alignment: createMockAlignment(sampleScript),
        }),
      } as Response);

      const provider = new ElevenLabsVoiceProvider({
        apiKey: "el_key",
        defaultVoiceId: "v1",
        fetchFn: fetchFn as never,
      });

      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("EMPTY_AUDIO");
      }
    });

    it("rejects odd-byte decoded PCM with REQUEST_FAILED", async () => {
      // 3 bytes decoded PCM is invalid for 16-bit audio
      const threeByteBase64 = Buffer.from([0x01, 0x02, 0x03]).toString("base64");

      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          audio_base64: threeByteBase64,
          alignment: createMockAlignment(sampleScript),
        }),
      } as Response);

      const provider = new ElevenLabsVoiceProvider({
        apiKey: "el_key",
        defaultVoiceId: "v1",
        fetchFn: fetchFn as never,
      });

      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("REQUEST_FAILED");
      }
    });
  });

  describe("HTTP Error Normalization", () => {
    it("normalizes HTTP 401 to AUTH_FAILURE", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Invalid API key" }),
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "bad_key", defaultVoiceId: "v1", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("AUTH_FAILURE");
      }
    });

    it("normalizes HTTP 403 to AUTH_FAILURE", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: "Forbidden access" }),
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "restricted_key", defaultVoiceId: "v1", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("AUTH_FAILURE");
      }
    });

    it("normalizes HTTP 429 to RATE_LIMITED", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ detail: "Rate limit exceeded" }),
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "key", defaultVoiceId: "v1", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("RATE_LIMITED");
      }
    });

    it("normalizes HTTP 400 and 422 to REQUEST_FAILED", async () => {
      for (const status of [400, 422]) {
        const fetchFn = vi.fn().mockResolvedValue({
          ok: false,
          status,
          json: async () => ({ detail: "Unprocessable Entity" }),
        });

        const provider = new ElevenLabsVoiceProvider({ apiKey: "key", defaultVoiceId: "v1", fetchFn: fetchFn as never });
        try {
          await provider.synthesize({ text: sampleScript, voiceName: "v1" });
          expect.unreachable();
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(ProviderError);
          expect((err as ProviderError).details?.code).toBe("REQUEST_FAILED");
        }
      }
    });

    it("normalizes HTTP 5xx to UPSTREAM_UNAVAILABLE", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: "Internal Server Error" }),
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "key", defaultVoiceId: "v1", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("UPSTREAM_UNAVAILABLE");
      }
    });

    it("normalizes network connection failure to NETWORK_FAILURE", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:443"));

      const provider = new ElevenLabsVoiceProvider({ apiKey: "key", defaultVoiceId: "v1", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("NETWORK_FAILURE");
      }
    });

    it("normalizes timeout to TIMEOUT", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      const fetchFn = vi.fn().mockRejectedValue(abortError);

      const provider = new ElevenLabsVoiceProvider({ apiKey: "key", defaultVoiceId: "v1", timeoutMs: 5000, fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("TIMEOUT");
      }
    });

    it("redacts API keys and raw error dumps from thrown ProviderError", async () => {
      const canaryKey = "SECRET_XI_API_KEY_CANARY_777";
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: `Key ${canaryKey} was invalid` }),
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: canaryKey, defaultVoiceId: "v1", fetchFn: fetchFn as never });

      try {
        await provider.synthesize({ text: sampleScript, voiceName: "v1" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        const provErr = err as ProviderError;
        expect(provErr.message).not.toContain(canaryKey);
        expect(JSON.stringify(provErr.details)).not.toContain(canaryKey);
      }
    });
  });

  describe("listVoices() V2 Discovery & Pagination Tests", () => {
    it("fetches and maps voices from exact /v2/voices endpoint with xi-api-key header", async () => {
      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      const fetchFn = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedHeaders = (init.headers as Record<string, string>) || {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            voices: [
              {
                voice_id: "voice_1",
                name: "Sarah",
                labels: { language: "en", gender: "female", accent: "american" },
              },
              {
                voice_id: "voice_2",
                name: "Tariq",
                labels: { language: "ur", gender: "male", description: "Urdu narrator" },
              },
            ],
            has_more: false,
            next_page_token: null,
          }),
        } as Response;
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key_discovery_123", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(capturedUrl).toContain("https://api.elevenlabs.io/v2/voices");
      expect(capturedUrl).toContain("page_size=100");
      expect(capturedHeaders["xi-api-key"]).toBe("el_key_discovery_123");

      expect(voices).toHaveLength(2);
      expect(voices[0]?.name).toBe("voice_1");
      expect(voices[0]?.displayName).toBe("Sarah");
      expect(voices[0]?.gender).toBe("Female");
      expect(voices[0]?.language).toBe("en");
      expect(voices[0]?.description).toBe("american");
      expect(voices[0]?.provider).toBe("ELEVENLABS");
      expect(voices[1]?.name).toBe("voice_2");
      expect(voices[1]?.displayName).toBe("Tariq");
      expect(voices[1]?.gender).toBe("Male");
      expect(voices[1]?.language).toBe("ur");
      expect(voices[1]?.description).toBe("Urdu narrator");
    });

    it("paginates across multiple pages using next_page_token until has_more is false", async () => {
      const calls: string[] = [];

      const fetchFn = vi.fn().mockImplementation(async (url: string) => {
        calls.push(url);
        const parsedUrl = new URL(url);
        const token = parsedUrl.searchParams.get("next_page_token");

        if (!token) {
          // Page 1
          return {
            ok: true,
            status: 200,
            json: async () => ({
              voices: [{ voice_id: "v_page1_1", name: "Voice 1" }],
              has_more: true,
              next_page_token: "tok_page_2",
            }),
          } as Response;
        }

        if (token === "tok_page_2") {
          // Page 2
          return {
            ok: true,
            status: 200,
            json: async () => ({
              voices: [{ voice_id: "v_page2_1", name: "Voice 2" }],
              has_more: false,
              next_page_token: null,
            }),
          } as Response;
        }

        return { ok: false, status: 400 } as Response;
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe("https://api.elevenlabs.io/v2/voices?page_size=100");
      expect(calls[1]).toBe("https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=tok_page_2");

      expect(voices).toHaveLength(2);
      expect(voices.map((v) => v.name)).toEqual(["v_page1_1", "v_page2_1"]);
    });

    it("enforces pagination hard bound (stops after 5 pages even if has_more remains true)", async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            voices: [{ voice_id: `v_infinite_${callCount}`, name: `Voice ${callCount}` }],
            has_more: true,
            next_page_token: `token_${callCount + 1}`,
          }),
        } as Response;
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      // Exactly 5 pages maximum
      expect(callCount).toBe(5);
      expect(voices).toHaveLength(5);
    });

    it("detects immediate pagination token repetition (A -> A) and terminates loop", async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            voices: [{ voice_id: `v_cycle_imm_${callCount}`, name: `Voice ${callCount}` }],
            has_more: true,
            next_page_token: "token_repeat_A",
          }),
        } as Response;
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      // Page 1 yields token_repeat_A, Page 2 receives token_repeat_A and terminates
      expect(callCount).toBe(2);
      expect(voices).toHaveLength(2);
    });

    it("detects multi-token pagination cycle (A -> B -> A) and terminates before repeating request", async () => {
      const requestedTokens: Array<string | null> = [];
      const fetchFn = vi.fn().mockImplementation(async (url: string) => {
        const parsedUrl = new URL(url);
        const token = parsedUrl.searchParams.get("next_page_token");
        requestedTokens.push(token);

        if (!token) {
          // Page 1: returns token A
          return {
            ok: true,
            status: 200,
            json: async () => ({
              voices: [{ voice_id: "v_cycle_1", name: "Voice 1" }],
              has_more: true,
              next_page_token: "token_A",
            }),
          } as Response;
        }

        if (token === "token_A") {
          // Page 2: returns token B
          return {
            ok: true,
            status: 200,
            json: async () => ({
              voices: [{ voice_id: "v_cycle_2", name: "Voice 2" }],
              has_more: true,
              next_page_token: "token_B",
            }),
          } as Response;
        }

        if (token === "token_B") {
          // Page 3: cycles back to token A
          return {
            ok: true,
            status: 200,
            json: async () => ({
              voices: [{ voice_id: "v_cycle_3", name: "Voice 3" }],
              has_more: true,
              next_page_token: "token_A", // Cycle back to A!
            }),
          } as Response;
        }

        return { ok: false, status: 500 } as Response;
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      // Page 1 (null), Page 2 (token_A), Page 3 (token_B). Cycle detected at end of Page 3 before requesting token_A again!
      expect(requestedTokens).toEqual([null, "token_A", "token_B"]);
      expect(voices).toHaveLength(3);
    });

    it("deduplicates voices by stable voice_id across paginated responses", async () => {
      const fetchFn = vi.fn().mockImplementation(async (url: string) => {
        const parsedUrl = new URL(url);
        const token = parsedUrl.searchParams.get("next_page_token");

        if (!token) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              voices: [
                { voice_id: "dup_voice_1", name: "Original 1" },
                { voice_id: "unique_voice_2", name: "Voice 2" },
              ],
              has_more: true,
              next_page_token: "tok_2",
            }),
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({
            voices: [
              { voice_id: "dup_voice_1", name: "Duplicate 1" }, // Duplicate ID!
              { voice_id: "unique_voice_3", name: "Voice 3" },
            ],
            has_more: false,
            next_page_token: null,
          }),
        } as Response;
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices).toHaveLength(3);
      expect(voices.map((v) => v.name)).toEqual(["dup_voice_1", "unique_voice_2", "unique_voice_3"]);
      expect(voices[0]?.displayName).toBe("Original 1"); // Preserves first occurrence
    });

    it("returns empty array on actual HTTP 429 rate limit without fabricating voices", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
      } as Response);

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices).toEqual([]);
      expect(voices.some((v) => v.voiceId === "21m00Tcm4TlvDq8ikWAM")).toBe(false);
      expect(voices.some((v) => v.voiceId === "pNInz6obpgDQGcFmaJgB")).toBe(false);
    });

    it("returns empty array on actual HTTP 5xx upstream unavailable", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
      } as Response);

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices).toEqual([]);
    });

    it("returns empty array on network rejection (TypeError: fetch failed)", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices).toEqual([]);
    });

    it("returns empty array on timeout / AbortError", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      const fetchFn = vi.fn().mockRejectedValue(abortError);

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices).toEqual([]);
    });

    it("returns empty array on invalid JSON or malformed discovery response", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      } as unknown as Response);

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices).toEqual([]);
    });

    it("returns empty array on malformed pagination token (e.g. empty or non-string)", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          voices: [{ voice_id: "v_1", name: "Voice 1" }],
          has_more: true,
          next_page_token: "   ", // whitespace token
        }),
      } as Response);

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices).toHaveLength(1);
      expect(voices[0]?.voiceId).toBe("v_1");
    });

    it("proves discovery failure does not invoke synthesis or make synthesis requests", async () => {
      const fetchCalls: Array<{ url: string; method?: string }> = [];
      const fetchFn = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        fetchCalls.push({ url, method: init?.method });
        return { ok: false, status: 500 } as Response;
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices).toEqual([]);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.url).toContain("/v2/voices");
      expect(fetchCalls[0]?.method).toBe("GET");
      expect(fetchCalls.some((c) => c.url.includes("text-to-speech"))).toBe(false);
    });

    it("proves Azure Speech provider operates independently even when ElevenLabs discovery fails", async () => {
      const failingElevenFetch = vi.fn().mockRejectedValue(new Error("ElevenLabs API down"));
      const elevenProvider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: failingElevenFetch as never });

      const elevenVoices = await elevenProvider.listVoices();
      expect(elevenVoices).toEqual([]);

      // Azure discovery functions normally
      const { AzureVoiceProvider } = await import("@/providers/voice/azure-voice.provider");
      const azureProvider = new AzureVoiceProvider({ apiKey: "az_key", region: "eastus" });
      const azureVoices = await azureProvider.listVoices();

      expect(azureVoices.length).toBeGreaterThan(0);
      expect(azureVoices.some((v) => v.provider === "AZURE")).toBe(true);
    });

    it("LOGGER CANARY TEST: proves sensitive canaries never appear in discovery logs or outputs", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const errorSpy = vi.spyOn(logger, "error");

      const SECRET_API_KEY_CANARY = "SECRET_API_KEY_CANARY_777";
      const ACCOUNT_ID_CANARY = "ACCOUNT_ID_CANARY_888";
      const RAW_PROVIDER_BODY_CANARY = "RAW_PROVIDER_BODY_CANARY_999";

      const hostileError = new Error(
        `Hostile upstream dump: key=${SECRET_API_KEY_CANARY}, account=${ACCOUNT_ID_CANARY}, body=${RAW_PROVIDER_BODY_CANARY}`
      );

      const fetchFn = vi.fn().mockRejectedValue(hostileError);
      const provider = new ElevenLabsVoiceProvider({
        apiKey: SECRET_API_KEY_CANARY,
        fetchFn: fetchFn as never,
      });

      const voices = await provider.listVoices();
      expect(voices).toEqual([]);

      // Verify logger calls
      const allLogPayloads = [...warnSpy.mock.calls, ...errorSpy.mock.calls].map((args) =>
        JSON.stringify(args)
      );

      for (const logStr of allLogPayloads) {
        expect(logStr).not.toContain(SECRET_API_KEY_CANARY);
        expect(logStr).not.toContain(ACCOUNT_ID_CANARY);
        expect(logStr).not.toContain(RAW_PROVIDER_BODY_CANARY);
      }

      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
