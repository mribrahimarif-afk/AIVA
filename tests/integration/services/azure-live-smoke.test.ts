import { describe, it, expect } from "vitest";
import { getEnv } from "@/infrastructure/config/env";
import { AzureVoiceProvider } from "@/providers/voice/azure-voice.provider";

describe("Azure Speech Live Smoke Test (Opt-in)", () => {
  const env = getEnv();
  const isConfigured = Boolean(
    env.AZURE_SPEECH_KEY &&
      env.AZURE_SPEECH_KEY.trim().length > 0 &&
      env.AZURE_SPEECH_REGION &&
      env.AZURE_SPEECH_REGION.trim().length > 0
  );

  const testFn = isConfigured ? it : it.skip;

  testFn("synthesizes short live audio and captures word boundaries from Azure", async () => {
    const provider = new AzureVoiceProvider({
      apiKey: env.AZURE_SPEECH_KEY,
      region: env.AZURE_SPEECH_REGION,
    });

    const result = await provider.synthesize({
      text: "AIVA Voice live smoke test.",
      voiceName: "ur-PK-AsadNeural",
    });

    expect(result.audioData).toBeInstanceOf(Buffer);
    expect(result.audioData.length).toBeGreaterThan(100);
    expect(result.audioDurationTicks).toBeGreaterThan(0);
    expect(result.boundaries.length).toBeGreaterThan(0);

    // Security check: ensure API key does not appear anywhere in result
    expect(JSON.stringify(result)).not.toContain(env.AZURE_SPEECH_KEY);
  });
});
