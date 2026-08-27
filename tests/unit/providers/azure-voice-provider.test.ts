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
    const provider = new AzureVoiceProvider({
      apiKey: secretKey,
      region: secretRegion,
      timeoutMs: 50, // 50ms timeout for test
    });

    const closeSpy = vi.spyOn(sdk.SpeechSynthesizer.prototype, "close");

    vi.spyOn(sdk.SpeechSynthesizer.prototype, "speakTextAsync").mockImplementation(
      () => {
        // intentionally hang without calling callbacks
      }
    );

    try {
      await provider.synthesize({ text: "Hello" });
      expect.unreachable();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProviderError);
      const pe = err as ProviderError;
      expect(pe.details?.code).toBe("TIMEOUT");
      expect(pe.details?.timeoutMs).toBe(50);
      expect(closeSpy).toHaveBeenCalled();
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
});
