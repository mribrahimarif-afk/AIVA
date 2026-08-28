import fs from "node:fs";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { ProviderError } from "@/domain/errors";
import {
  buildCanonicalTranscript,
  assertValidTranscriptionWords,
  type RawTranscriptionWord,
  type TranscriptionResult,
  type TranscriptionProviderId,
} from "@/domain/transcription";
import { normalizeAudioForAzure } from "@/storage/audio-normalizer";
import type {
  TranscriptionInput,
  TranscriptionProvider,
} from "./transcription-provider.interface";
import type { Logger } from "@/infrastructure/logging/logger";

export interface AzureTranscribeProviderOptions {
  apiKey?: string;
  region?: string;
  timeoutMs?: number;
  logger?: Logger;
}

export class AzureTranscribeProvider implements TranscriptionProvider {
  readonly id: TranscriptionProviderId = "azure-speech-stt";
  readonly modelName = "azure-speech-continuous-stt";
  private readonly apiKey: string;
  private readonly region: string;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;

  constructor(options: AzureTranscribeProviderOptions = {}) {
    this.apiKey = options.apiKey !== undefined ? options.apiKey : (process.env.AZURE_SPEECH_KEY || "");
    this.region = options.region !== undefined ? options.region : (process.env.AZURE_SPEECH_REGION || "");
    this.timeoutMs = options.timeoutMs || 45000;
    this.logger = options.logger;
  }

  isConfigured(): boolean {
    return Boolean(
      this.apiKey &&
        this.apiKey.trim().length > 0 &&
        this.region &&
        this.region.trim().length > 0
    );
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (!this.isConfigured()) {
      throw new ProviderError(
        this.id,
        "Azure Speech-to-Text is not configured. AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing.",
        { code: "UNCONFIGURED", provider: this.id }
      );
    }

    const { audioBuffer, sourceFilePath, projectId, audioSourceId, requestedMode } = input;
    const startTime = Date.now();

    // 1. Normalize audio to a temporary 16kHz 16-bit mono WAV for Azure Speech SDK
    let tempWavPath: string | undefined;
    let cleanupNormalized: (() => Promise<void>) | undefined;

    try {
      if (sourceFilePath) {
        const norm = await normalizeAudioForAzure(sourceFilePath, audioBuffer);
        tempWavPath = norm.tempWavPath;
        cleanupNormalized = norm.cleanup;
      } else {
        // If only buffer is passed, write a temp source file first then normalize
        const fs = await import("node:fs");
        const path = await import("node:path");
        const crypto = await import("node:crypto");
        const { getTempRoot } = await import("@/storage/paths");

        const tempSrcPath = path.join(getTempRoot(), `temp-src-${crypto.randomUUID()}`);
        await fs.promises.writeFile(tempSrcPath, audioBuffer);
        try {
          const norm = await normalizeAudioForAzure(tempSrcPath, audioBuffer);
          tempWavPath = norm.tempWavPath;
          cleanupNormalized = norm.cleanup;
        } finally {
          try {
            await fs.promises.unlink(tempSrcPath);
          } catch {
            // Ignore
          }
        }
      }

      // 2. Configure Speech SDK
      const speechConfig = sdk.SpeechConfig.fromSubscription(this.apiKey, this.region);
      speechConfig.outputFormat = sdk.OutputFormat.Detailed;
      speechConfig.requestWordLevelTimestamps();

      const wavBuffer = fs.readFileSync(tempWavPath);
      const audioConfig = sdk.AudioConfig.fromWavFileInput(wavBuffer);

      // Auto-detect source language with candidate locales for Urdu and English
      let recognizer: sdk.SpeechRecognizer;
      try {
        const autoDetectConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages([
          "ur-PK",
          "en-US",
        ]);
        recognizer = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetectConfig, audioConfig);
      } catch {
        // Fallback to default speech recognizer if auto-detect cannot be created
        speechConfig.speechRecognitionLanguage = "ur-PK";
        recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      }

      // 3. Execute Continuous Recognition
      const rawWords: RawTranscriptionWord[] = [];
      let fullDisplayText = "";
      let detectedLocale: string | null = null;
      let sessionError: Error | null = null;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          try {
            recognizer.stopContinuousRecognitionAsync();
          } catch {
            // Ignore
          }
          reject(new ProviderError(this.id, "Azure Speech recognition timed out", { code: "TIMEOUT" }));
        }, this.timeoutMs);

        recognizer.recognized = (_, e) => {
          if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
            fullDisplayText += (fullDisplayText ? " " : "") + e.result.text;

            // Extract language if detected
            const autoDetectResult = sdk.AutoDetectSourceLanguageResult.fromResult(e.result);
            if (autoDetectResult?.language) {
              detectedLocale = autoDetectResult.language;
            }

            // Extract detailed word-level timestamps from json payload
            const jsonStr = e.result.properties.getProperty(
              sdk.PropertyId.SpeechServiceResponse_JsonResult
            );
            if (jsonStr) {
              try {
                const parsed = JSON.parse(jsonStr);
                const nbest = parsed.NBest?.[0];
                if (nbest && Array.isArray(nbest.Words)) {
                  for (const w of nbest.Words) {
                    const wordText = String(w.Word || "").trim();
                    if (!wordText) continue;

                    // Azure timestamps are in 100-nanosecond ticks (1 tick = 0.0001 ms)
                    const startMs = Math.round(Number(w.Offset || 0) / 10000);
                    const durationMs = Math.round(Number(w.Duration || 0) / 10000);
                    const endMs = startMs + durationMs;

                    rawWords.push({
                      text: wordText,
                      startMs,
                      endMs,
                      confidence: typeof w.Confidence === "number" ? w.Confidence : null,
                      locale: detectedLocale,
                    });
                  }
                }
              } catch {
                // Ignore parse errors on individual phrases
              }
            }
          } else if (e.result.reason === sdk.ResultReason.NoMatch) {
            // No speech recognized in phrase segment
          }
        };

        recognizer.canceled = (_, e) => {
          if (e.reason === sdk.CancellationReason.Error) {
            sessionError = new ProviderError(
              this.id,
              `Azure Speech recognition canceled: ${e.errorDetails}`,
              { code: "RECOGNITION_ERROR", details: e.errorDetails }
            );
          }
          recognizer.stopContinuousRecognitionAsync(
            () => resolve(),
            (err) => reject(err)
          );
        };

        recognizer.sessionStopped = () => {
          clearTimeout(timer);
          recognizer.stopContinuousRecognitionAsync(
            () => resolve(),
            (err) => reject(err)
          );
        };

        recognizer.startContinuousRecognitionAsync(
          () => {
            // Recognition started
          },
          (err) => {
            clearTimeout(timer);
            reject(new ProviderError(this.id, `Failed to start Azure Speech recognition: ${err}`, { cause: err }));
          }
        );
      });

      if (sessionError) {
        throw sessionError;
      }

      // 4. Handle NO_SPEECH
      if (rawWords.length === 0) {
        if (!fullDisplayText || fullDisplayText.trim().length === 0) {
          return {
            provider: this.id,
            model: this.modelName,
            requestedMode,
            displayText: "",
            canonicalText: "",
            detectedLanguage: null,
            durationMs: 0,
            wordCount: 0,
            words: [],
            noSpeech: true,
          };
        }
        throw new ProviderError(
          this.id,
          "Azure Speech recognition returned text but failed to produce word timestamps",
          { code: "MISSING_TIMESTAMPS" }
        );
      }

      // 5. Validate word timing invariants
      assertValidTranscriptionWords(rawWords);

      // 6. Build canonical transcript and exact UTF-16 slices
      const canonical = buildCanonicalTranscript(rawWords);
      const lastWord = rawWords[rawWords.length - 1];
      const durationMs = lastWord ? lastWord.endMs : 0;
      const elapsedMs = Date.now() - startTime;

      this.logger?.info({
        event: "transcription.azure_success",
        projectId,
        audioSourceId,
        provider: this.id,
        model: this.modelName,
        wordCount: canonical.words.length,
        durationMs,
        elapsedMs,
      });

      return {
        provider: this.id,
        model: this.modelName,
        requestedMode,
        displayText: fullDisplayText || canonical.canonicalText,
        canonicalText: canonical.canonicalText,
        detectedLanguage: detectedLocale,
        durationMs,
        wordCount: canonical.words.length,
        words: canonical.words,
      };
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        throw err;
      }

      const message =
        err instanceof Error ? err.message : "Azure Speech recognition request failed";

      let code = "UPSTREAM_UNAVAILABLE";
      if (message.includes("401") || message.includes("Authentication")) code = "AUTH_FAILED";
      else if (message.includes("403") || message.includes("Forbidden")) code = "FORBIDDEN";
      else if (message.includes("429") || message.includes("Quota")) code = "RATE_LIMITED";
      else if (message.includes("timeout") || message.includes("TIMEOUT")) code = "TIMEOUT";
      else if (message.includes("network") || message.includes("Connection")) code = "NETWORK_FAILURE";

      this.logger?.warn({
        event: "transcription.azure_failed",
        projectId,
        audioSourceId,
        provider: this.id,
        code,
        message,
        elapsedMs: Date.now() - startTime,
      });

      throw new ProviderError(this.id, `Azure Speech recognition failed (${code}): ${message}`, {
        code,
        provider: this.id,
      });
    } finally {
      // Guaranteed cleanup of temporary normalized WAV in finally
      if (cleanupNormalized) {
        await cleanupNormalized();
      }
    }
  }
}
