import { describe, it, expect, vi, beforeEach } from "vitest";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { AzureVoiceProvider } from "@/providers/voice/azure-voice.provider";
import { ProviderError } from "@/domain/errors";

describe("AzureVoiceProvider Unit & Security Tests", () => {
  const secretKey = "test-azure-secret-key-12345";
  const secretRegion = "eastus";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports unconfigured when apiKey or region is empty", () => {
    const unconfigured1 = new AzureVoiceProvider({ apiKey: "", region: "eastus" });
    expect(unconfigured1.isConfigured()).toBe(false);

    const unconfigured2 = new AzureVoiceProvider({ apiKey: "key", region: "" });
    expect(unconfigured2.isConfigured()).toBe(false);

    const configured = new AzureVoiceProvider({ apiKey: "key", region: "eastus" });
    expect(configured.isConfigured()).toBe(true);
  });

  it("throws VOICE_UNCONFIGURED ProviderError if synthesize is called when unconfigured", async () => {
    const provider = new AzureVoiceProvider({ apiKey: "", region: "" });
    await expect(provider.synthesize({ text: "Hello" })).rejects.toThrow(ProviderError);

    try {
      await provider.synthesize({ text: "Hello" });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const pe = err as ProviderError;
      expect(pe.details?.code).toBe("VOICE_UNCONFIGURED");
    }
  });

  it("rejects unsupported voice profiles with INVALID_VOICE", async () => {
    const provider = new AzureVoiceProvider({
      apiKey: secretKey,
      region: secretRegion,
    });

    await expect(
      provider.synthesize({
        text: "Hello",
        voiceName: "unsupported-alien-voice" as never,
      })
    ).rejects.toThrow(ProviderError);
  });

  it("rejects empty script with EMPTY_AUDIO", async () => {
    const provider = new AzureVoiceProvider({
      apiKey: secretKey,
      region: secretRegion,
    });

    await expect(provider.synthesize({ text: "   " })).rejects.toThrow(ProviderError);
  });

  it("normalizes Azure 401/auth cancellation into safe AUTH_FAILURE without leaking keys", async () => {
    const provider = new AzureVoiceProvider({
      apiKey: secretKey,
      region: secretRegion,
    });

    // Mock SpeechSynthesizer and CancellationDetails
    vi.spyOn(sdk.CancellationDetails, "fromResult").mockReturnValue({
      reason: sdk.CancellationReason.Error,
      errorDetails: `Access denied due to invalid subscription key ${secretKey} on endpoint https://${secretRegion}.tts.speech.microsoft.com`,
      ErrorCode: sdk.CancellationErrorCode.AuthenticationFailure,
    } as unknown as sdk.CancellationDetails);

    vi.spyOn(sdk.SpeechSynthesizer.prototype, "speakTextAsync").mockImplementation(
      (_text, cb) => {
        const fakeResult = {
          reason: sdk.ResultReason.Canceled,
        };
        if (cb) cb(fakeResult as unknown as sdk.SpeechSynthesisResult);
      }
    );

    let caughtError: ProviderError | null = null;
    try {
      await provider.synthesize({ text: "Hello" });
    } catch (err: unknown) {
      caughtError = err as ProviderError;
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError!.details?.code).toBe("AUTH_FAILURE");
    expect(caughtError!.message).not.toContain(secretKey);
    expect(caughtError!.message).not.toContain(secretRegion);
    expect(JSON.stringify(caughtError!.details)).not.toContain(secretKey);
  });

  it("normalizes rate limiting cancellations into safe RATE_LIMITED", async () => {
    const provider = new AzureVoiceProvider({
      apiKey: secretKey,
      region: secretRegion,
    });

    vi.spyOn(sdk.SpeechSynthesizer.prototype, "speakTextAsync").mockImplementation(
      (_text, cb) => {
        const fakeResult = {
          reason: sdk.ResultReason.Canceled,
          errorDetails: "Too many requests. Quota exceeded: 429",
          ErrorCode: sdk.CancellationErrorCode.TooManyRequests,
        };
        if (cb) cb(fakeResult as unknown as sdk.SpeechSynthesisResult);
      }
    );

    try {
      await provider.synthesize({ text: "Hello" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("RATE_LIMITED");
    }
  });

  it("normalizes network failures into safe NETWORK_FAILURE", async () => {
    const provider = new AzureVoiceProvider({
      apiKey: secretKey,
      region: secretRegion,
    });

    vi.spyOn(sdk.SpeechSynthesizer.prototype, "speakTextAsync").mockImplementation(
      (_text, _cb, errCb) => {
        if (errCb) errCb("connect ECONNREFUSED 10.0.0.1:443");
      }
    );

    try {
      await provider.synthesize({ text: "Hello" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).details?.code).toBe("NETWORK_FAILURE");
    }
  });

  it("times out and cancels synthesis when Azure execution exceeds timeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const provider = new AzureVoiceProvider({
        apiKey: secretKey,
        region: secretRegion,
        timeoutMs: 5000, // Valid bound >= 5000
      });

      const closeSpy = vi.spyOn(sdk.SpeechSynthesizer.prototype, "close");

      vi.spyOn(sdk.SpeechSynthesizer.prototype, "speakTextAsync").mockImplementation(
        () => {
          // intentionally hang without calling callbacks
        }
      );

      let caughtErr: unknown = null;
      const promise = provider.synthesize({ text: "Hello" }).catch((err) => {
        caughtErr = err;
      });

      await vi.advanceTimersByTimeAsync(5001);
      await promise;

      expect(caughtErr).toBeInstanceOf(ProviderError);
      const pe = caughtErr as ProviderError;
      expect(pe.details?.code).toBe("TIMEOUT");
      expect(pe.details?.timeoutMs).toBe(5000);
      expect(closeSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("successfully captures word boundary events and returns audio buffer", async () => {
    const provider = new AzureVoiceProvider({
      apiKey: secretKey,
      region: secretRegion,
    });

    const fakeAudioData = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]).buffer;

    vi.spyOn(sdk.SpeechSynthesizer.prototype, "speakTextAsync").mockImplementation(
      function (this: sdk.SpeechSynthesizer, _text, cb) {
        if (this.wordBoundary) {
          this.wordBoundary(this, {
            boundaryType: sdk.SpeechSynthesisBoundaryType.Word,
            text: "Hello",
            textOffset: 0,
            wordLength: 5,
            audioOffset: 1000000,
            duration: 4000000,
          } as unknown as sdk.SpeechSynthesisWordBoundaryEventArgs);
        }

        const fakeResult = {
          reason: sdk.ResultReason.SynthesizingAudioCompleted,
          audioData: fakeAudioData,
          audioDuration: 25000000,
        };
        if (cb) cb(fakeResult as unknown as sdk.SpeechSynthesisResult);
      }
    );

    const result = await provider.synthesize({ text: "Hello world" });
    expect(result.audioData).toBeInstanceOf(Buffer);
    expect(result.audioDurationTicks).toBe(25000000);
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0]?.text).toBe("Hello");
  });

  describe("Fail-Closed Timeout Validation & Enum Boundary Filtering", () => {
    it("fails closed when timeoutMs is NaN, Infinity, negative, zero, fraction, or out of bounds", () => {
      const invalidTimeouts = [NaN, Infinity, -Infinity, 0, -5000, 2.5, 1000, 999999999];
      for (const t of invalidTimeouts) {
        expect(() => {
          new AzureVoiceProvider({
            apiKey: secretKey,
            region: secretRegion,
            timeoutMs: t as number,
          });
        }).toThrow(ProviderError);
      }
    });

    it("strictly accepts only SpeechSynthesisBoundaryType.Word and ignores non-Word boundary events", async () => {
      const provider = new AzureVoiceProvider({
        apiKey: secretKey,
        region: secretRegion,
        timeoutMs: 10000,
      });

      const fakeAudioData = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]).buffer;

      vi.spyOn(sdk.SpeechSynthesizer.prototype, "speakTextAsync").mockImplementation(
        function (this: sdk.SpeechSynthesizer, _text, cb) {
          if (this.wordBoundary) {
            // Send Word event
            this.wordBoundary(this, {
              boundaryType: sdk.SpeechSynthesisBoundaryType.Word,
              text: "Hello",
              textOffset: 0,
              wordLength: 5,
              audioOffset: 1000000,
              duration: 4000000,
            } as unknown as sdk.SpeechSynthesisWordBoundaryEventArgs);

            // Send non-Word event (Sentence)
            this.wordBoundary(this, {
              boundaryType: sdk.SpeechSynthesisBoundaryType.Sentence,
              text: "Hello world.",
              textOffset: 0,
              wordLength: 12,
              audioOffset: 1000000,
              duration: 8000000,
            } as unknown as sdk.SpeechSynthesisWordBoundaryEventArgs);

            // Send non-Word event (Punctuation)
            this.wordBoundary(this, {
              boundaryType: sdk.SpeechSynthesisBoundaryType.Punctuation,
              text: ".",
              textOffset: 11,
              wordLength: 1,
              audioOffset: 7000000,
              duration: 1000000,
            } as unknown as sdk.SpeechSynthesisWordBoundaryEventArgs);
          }

          const fakeResult = {
            reason: sdk.ResultReason.SynthesizingAudioCompleted,
            audioData: fakeAudioData,
            audioDuration: 25000000,
          };
          if (cb) cb(fakeResult as unknown as sdk.SpeechSynthesisResult);
        }
      );

      const result = await provider.synthesize({ text: "Hello world." });
      // Only the Word boundary should have been retained
      expect(result.boundaries).toHaveLength(1);
      expect(result.boundaries[0]?.text).toBe("Hello");
      expect(result.boundaries[0]?.boundaryType).toBe("Word");
    });

    it("redacts hostile canaries, file paths, authorization text, and secrets from upstream errors", async () => {
      const provider = new AzureVoiceProvider({
        apiKey: secretKey,
        region: secretRegion,
        timeoutMs: 10000,
      });

      const canary = "SECRET_CANARY_BEARER_TOKEN_999";
      const hostilePath = "/var/secrets/azure_credentials.json";

      vi.spyOn(sdk.SpeechSynthesizer.prototype, "speakTextAsync").mockImplementation(
        (_text, _cb, errCb) => {
          if (errCb) {
            errCb(`Fatal upstream error at ${hostilePath} with header Authorization: Bearer ${canary}`);
          }
        }
      );

      try {
        await provider.synthesize({ text: "Hello" });
        expect.unreachable();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ProviderError);
        const pe = err as ProviderError;
        expect(pe.message).not.toContain(canary);
        expect(pe.message).not.toContain(hostilePath);
        expect(JSON.stringify(pe.details)).not.toContain(canary);
        expect(JSON.stringify(pe.details)).not.toContain(hostilePath);
      }
    });
  });
});
