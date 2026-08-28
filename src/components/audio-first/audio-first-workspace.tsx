"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  AudioSourceInfo,
  TranscriptionRecord,
  TranscriptionMode,
} from "@/domain/transcription";
import type { Brand } from "@/domain/brand";

interface AudioFirstWorkspaceProps {
  projectId: string;
  initialAudioSource?: AudioSourceInfo | null;
  initialTranscription?: TranscriptionRecord | null;
  geminiConfigured: boolean;
  azureConfigured: boolean;
  elevenLabsSttEnabled: boolean;
  elevenLabsSttConfigured: boolean;
  brands?: Brand[];
  onDirectorPlanUpdated?: () => void;
}

export function AudioFirstWorkspace({
  projectId,
  initialAudioSource,
  initialTranscription,
  geminiConfigured,
  azureConfigured,
  elevenLabsSttEnabled,
  elevenLabsSttConfigured,
  brands = [],
  onDirectorPlanUpdated,
}: AudioFirstWorkspaceProps) {
  const [audioSource, setAudioSource] = useState<AudioSourceInfo | null>(
    initialAudioSource ?? null
  );
  const [transcription, setTranscription] = useState<TranscriptionRecord | null>(
    initialTranscription ?? null
  );
  const [selectedMode, setSelectedMode] = useState<TranscriptionMode>("AUTO");
  const [isUploading, setIsUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isFeedingDirector, setIsFeedingDirector] = useState(false);
  const [selectedBrandId, setSelectedBrandId] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const currentBrand = brands.find((b) => b.id === selectedBrandId);
  const availableProducts = currentBrand?.products || [];

  // Determine provider configuration eligibility
  const autoAvailable = geminiConfigured || azureConfigured;
  const geminiAvailable = geminiConfigured;
  const azureAvailable = azureConfigured;
  const elevenLabsAvailable = elevenLabsSttEnabled && elevenLabsSttConfigured;

  let canTranscribeForSelectedMode = false;
  if (selectedMode === "AUTO") canTranscribeForSelectedMode = autoAvailable;
  else if (selectedMode === "GEMINI") canTranscribeForSelectedMode = geminiAvailable;
  else if (selectedMode === "AZURE") canTranscribeForSelectedMode = azureAvailable;
  else if (selectedMode === "ELEVENLABS") canTranscribeForSelectedMode = elevenLabsAvailable;

  const canTranscribe = Boolean(
    audioSource && canTranscribeForSelectedMode && !isTranscribing && !isUploading
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`/api/projects/${projectId}/audio-source`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to upload audio file");
      }

      setAudioSource(data.audioSource);
      setSuccessMessage(`Audio uploaded successfully (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload audio");
    } finally {
      setIsUploading(false);
    }
  };

  const handleTranscribe = async (force = false) => {
    if (!audioSource) return;

    setIsTranscribing(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/transcription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioSourceId: audioSource.id,
          mode: selectedMode,
          force,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Transcription failed");
      }

      setTranscription(data.transcription);
      setSuccessMessage(
        `Transcription complete using ${data.transcription.provider} (${data.transcription.model})`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to transcribe audio");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleUseWithDirector = async () => {
    if (!transcription) return;

    setIsFeedingDirector(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(
        `/api/projects/${projectId}/transcription/${transcription.id}/use-with-director`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandId: selectedBrandId || undefined,
            productId: selectedProductId || undefined,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to feed transcript to Director");
      }

      setSuccessMessage("Director Plan generated successfully from audio transcript!");
      if (onDirectorPlanUpdated) {
        onDirectorPlanUpdated();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate Director plan");
    } finally {
      setIsFeedingDirector(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="audio-first-workspace">
      {/* Configuration Status Warnings */}
      {!autoAvailable && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 text-sm text-amber-200"
        >
          <div className="flex items-center gap-2 font-medium">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Transcription Providers Unconfigured
          </div>
          <p className="mt-1 text-xs text-amber-300/80">
            Neither Gemini (<code>GEMINI_API_KEY</code>) nor Azure (<code>AZURE_SPEECH_KEY</code>) is
            configured. Please set credentials in <code>.env</code> to transcribe audio.
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-4 text-sm text-rose-200"
        >
          <span className="font-medium">Transcription Error: </span>
          {error}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-950/20 p-4 text-sm text-emerald-200"
        >
          {successMessage}
        </div>
      )}

      {/* 1. Upload Section */}
      <Card className="p-6">
        <h3 className="text-base font-semibold text-neutral-100">1. Upload Existing Audio (Flow B)</h3>
        <p className="mt-1 text-xs text-neutral-400">
          Upload existing voiceover audio in WAV, MP3, M4A, AAC, OGG, or WebM format (max 50 MB, up to 30 mins).
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.webm"
            onChange={handleFileUpload}
            disabled={isUploading || isTranscribing}
            className="block w-full text-sm text-neutral-400 file:mr-4 file:rounded-md file:border-0 file:bg-neutral-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-neutral-200 hover:file:bg-neutral-700"
          />

          {audioSource && (
            <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-neutral-200">
                    {audioSource.originalDisplayName || "Audio File"}
                  </span>
                  <span className="ml-2 text-neutral-500">
                    ({(audioSource.sizeBytes / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                  {audioSource.durationMs && (
                    <span className="ml-2 text-neutral-400">
                      Duration: {(audioSource.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <Badge tone="neutral" className="text-[10px]">
                  {audioSource.mimeType}
                </Badge>
              </div>

              {/* Audio Player */}
              <div className="mt-3">
                <audio
                  controls
                  className="w-full h-8"
                  src={`/api/projects/${projectId}/audio-source/${audioSource.id}/content`}
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* 2. Transcription Controls */}
      <Card className="p-6">
        <h3 className="text-base font-semibold text-neutral-100">2. Transcribe Audio</h3>
        <p className="mt-1 text-xs text-neutral-400">
          Select transcription mode and generate verbatim word timestamps.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          {/* Mode Selector */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-neutral-300">Mode:</label>
            <select
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value as TranscriptionMode)}
              className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 focus:border-neutral-700 focus:outline-none"
            >
              <option value="AUTO">AUTO (Gemini 3.5 → Azure Fallback)</option>
              <option value="GEMINI" disabled={!geminiAvailable}>
                GEMINI (Primary Only {!geminiAvailable ? "- Unconfigured" : ""})
              </option>
              <option value="AZURE" disabled={!azureAvailable}>
                AZURE (Continuous STT {!azureAvailable ? "- Unconfigured" : ""})
              </option>
              {elevenLabsSttEnabled && (
                <option value="ELEVENLABS" disabled={!elevenLabsAvailable}>
                  ELEVENLABS (Scribe v2 {!elevenLabsAvailable ? "- Unconfigured" : ""})
                </option>
              )}
            </select>
          </div>

          {/* Action Buttons */}
          <div className="mt-auto flex items-center gap-2">
            <Button
              onClick={() => handleTranscribe(false)}
              disabled={!canTranscribe}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-2"
            >
              {isTranscribing ? "Transcribing..." : "Transcribe Audio"}
            </Button>

            {transcription && (
              <Button
                variant="secondary"
                onClick={() => handleTranscribe(true)}
                disabled={!canTranscribe}
                className="text-xs px-3 py-2 border border-neutral-700 hover:bg-neutral-800"
              >
                Force Retranscribe
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* 3. Transcript Review (Read-Only) */}
      {transcription && (
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-neutral-100">3. Accepted Transcript Review</h3>
            <div className="flex items-center gap-2">
              <Badge tone="info" className="text-[10px]">
                {transcription.provider}
              </Badge>
              <Badge tone="neutral" className="text-[10px]">
                {transcription.model}
              </Badge>
              {transcription.detectedLanguage && (
                <Badge tone="neutral" className="text-[10px]">
                  {transcription.detectedLanguage}
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-4 text-xs text-neutral-400">
            <span>Duration: {(transcription.durationMs / 1000).toFixed(2)}s</span>
            <span>•</span>
            <span>Words: {transcription.wordCount}</span>
            <span>•</span>
            <span>Mode: {transcription.requestedMode}</span>
          </div>

          {/* Read-Only Transcript Display */}
          <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-4 font-mono text-sm leading-relaxed text-neutral-200 select-text">
            {transcription.displayText || transcription.canonicalText}
          </div>

          {/* 4. Feed into AIVA Director */}
          <div className="mt-6 border-t border-neutral-800 pt-6">
            <h4 className="text-sm font-medium text-neutral-200">
              4. Generate Director Scene Plan from Transcript
            </h4>
            <p className="mt-1 text-xs text-neutral-400">
              Directly feed this accepted canonical transcript into AIVA Director without copy-pasting.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              {brands.length > 0 && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-neutral-400">Brand Context:</label>
                    <select
                      value={selectedBrandId}
                      onChange={(e) => {
                        setSelectedBrandId(e.target.value);
                        setSelectedProductId("");
                      }}
                      className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200"
                    >
                      <option value="">None</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {availableProducts.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-neutral-400">Product Context:</label>
                      <select
                        value={selectedProductId}
                        onChange={(e) => setSelectedProductId(e.target.value)}
                        className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200"
                      >
                        <option value="">None</option>
                        {availableProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              <div className="mt-auto">
                <Button
                  onClick={handleUseWithDirector}
                  disabled={isFeedingDirector}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2"
                >
                  {isFeedingDirector ? "Generating Plan..." : "Analyze Transcript with AIVA Director"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
