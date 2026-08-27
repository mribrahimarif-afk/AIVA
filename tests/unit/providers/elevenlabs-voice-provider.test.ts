import { describe, it, expect, vi } from "vitest";
import {
  ElevenLabsVoiceProvider,
  ELEVENLABS_MAX_CHARS_V3,
} from "@/providers/voice/elevenlabs-voice.provider";
import { ProviderError } from "@/domain/errors";

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
      await provider.synthesize({ text: sampleScript });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("VOICE_UNCONFIGURED");
    }
  });

  it("enforces 5,000 character preflight limit for eleven_v3 without calling network", async () => {
    const fetchFn = vi.fn();
    const provider = new ElevenLabsVoiceProvider({
      apiKey: "el_test_key_123",
      modelId: "eleven_v3",
      fetchFn: fetchFn as never,
    });

    const oversizedScript = "A".repeat(ELEVENLABS_MAX_CHARS_V3 + 1);

    try {
      await provider.synthesize({ text: oversizedScript });
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
      fetchFn: fetchFn as never,
    });

    await expect(provider.synthesize({ text: sampleScript })).rejects.toThrow(ProviderError);

    // Hard guarantee: exactly 1 call, zero auto-retries
    expect(callCount).toBe(1);
  });

  describe("HTTP Error Normalization", () => {
    it("normalizes HTTP 401 to AUTH_FAILURE", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ detail: "Invalid API key" }),
      });

      const provider = new ElevenLabsVoiceProvider({ apiKey: "bad_key", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript });
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

      const provider = new ElevenLabsVoiceProvider({ apiKey: "restricted_key", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript });
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

      const provider = new ElevenLabsVoiceProvider({ apiKey: "key", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript });
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

        const provider = new ElevenLabsVoiceProvider({ apiKey: "key", fetchFn: fetchFn as never });
        try {
          await provider.synthesize({ text: sampleScript });
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

      const provider = new ElevenLabsVoiceProvider({ apiKey: "key", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        expect((err as ProviderError).details?.code).toBe("UPSTREAM_UNAVAILABLE");
      }
    });

    it("normalizes network connection failure to NETWORK_FAILURE", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:443"));

      const provider = new ElevenLabsVoiceProvider({ apiKey: "key", fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript });
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

      const provider = new ElevenLabsVoiceProvider({ apiKey: "key", timeoutMs: 5000, fetchFn: fetchFn as never });
      try {
        await provider.synthesize({ text: sampleScript });
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

      const provider = new ElevenLabsVoiceProvider({ apiKey: canaryKey, fetchFn: fetchFn as never });

      try {
        await provider.synthesize({ text: sampleScript });
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

    it("returns safe fallback voices when API call fails without crashing Azure", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("Network down"));

      const provider = new ElevenLabsVoiceProvider({ apiKey: "el_key", fetchFn: fetchFn as never });
      const voices = await provider.listVoices();

      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0]?.displayName).toContain("Rachel");
    });
  });
});
