import { describe, it, expect } from "vitest";
import { ElevenLabsVoiceProvider } from "@/providers/voice/elevenlabs-voice.provider";

const hasElevenLabsKey = Boolean(
  process.env.ELEVENLABS_API_KEY &&
    process.env.ELEVENLABS_API_KEY.trim().length > 0 &&
    process.env.RUN_LIVE_TESTS === "true"
);

describe("ElevenLabs Live Smoke Test (Opt-in)", () => {
  it.skipIf(!hasElevenLabsKey)(
    "synthesizes short Roman Urdu test phrase with exact timing and WAV output when RUN_LIVE_TESTS is enabled",
    async () => {
      const provider = new ElevenLabsVoiceProvider({
        apiKey: process.env.ELEVENLABS_API_KEY,
        modelId: process.env.ELEVENLABS_MODEL_ID || "eleven_v3",
        defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
      });

      const script = "Aaj hum AIVA ki voice testing kar rahe hain.";
      const startTime = Date.now();

      const result = await provider.synthesize({
        text: script,
        voiceName: provider.defaultVoice,
      });

      const latencyMs = Date.now() - startTime;

      // 1. WAV Container Validation
      expect(result.audioData).toBeDefined();
      expect(result.audioData.length).toBeGreaterThan(1024);
      expect(result.audioData.toString("ascii", 0, 4)).toBe("RIFF");
      expect(result.audioData.toString("ascii", 8, 12)).toBe("WAVE");

      // 2. Timing and Boundaries Validation
      expect(result.audioDurationTicks).toBeGreaterThan(0);
      expect(result.boundaries.length).toBeGreaterThan(0);

      // 3. UTF-16 Script Fidelity
      for (const b of result.boundaries) {
        const slice = script.slice(b.textOffset, b.textOffset + b.wordLength);
        expect(b.text).toBe(slice);
      }

      console.log({
        status: "SUCCESS",
        provider: "ELEVENLABS",
        model: result.model,
        voiceName: result.voiceName,
        latencyMs,
        audioBytes: result.audioData.length,
        boundaryCount: result.boundaries.length,
        alignmentFidelity: "PASS",
      });
    },
    60000
  );
});
