"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  VoiceTrackDto,
  VoiceProfile,
  VoiceProviderId,
  VOICE_PROFILES,
} from "@/domain/voice";

export interface VoiceWorkspaceProps {
  projectId: string;
  hasDirectorPlan: boolean;
  directorScriptHash?: string;
  initialVoiceTrack?: VoiceTrackDto | null;
  isConfigured?: boolean;
  azureConfigured?: boolean;
  elevenLabsConfigured?: boolean;
  defaultVoice?: string;
  defaultAzureVoice?: string;
  defaultElevenLabsVoice?: string;
  supportedVoices?: VoiceProfile[]; // legacy prop
  azureVoices?: VoiceProfile[];
  elevenLabsVoices?: VoiceProfile[];
}

export function VoiceWorkspace({
  projectId,
  hasDirectorPlan,
  directorScriptHash,
  initialVoiceTrack = null,
  isConfigured = true,
  azureConfigured,
  elevenLabsConfigured = false,
  defaultVoice = "ur-PK-AsadNeural",
  defaultAzureVoice = "ur-PK-AsadNeural",
  defaultElevenLabsVoice = "",
  supportedVoices = Object.values(VOICE_PROFILES),
  azureVoices,
  elevenLabsVoices = [],
}: VoiceWorkspaceProps) {
  const isAzureConfig = azureConfigured !== undefined ? azureConfigured : isConfigured;
  const activeAzureVoices = azureVoices && azureVoices.length > 0 ? azureVoices : supportedVoices;

  const initialProvider: VoiceProviderId =
    initialVoiceTrack?.provider === "elevenlabs" || initialVoiceTrack?.provider === "ELEVENLABS"
      ? "ELEVENLABS"
      : "AZURE";

  const [selectedProvider, setSelectedProvider] = useState<VoiceProviderId>(initialProvider);
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    if (initialVoiceTrack?.voiceName) return initialVoiceTrack.voiceName;
    if (initialProvider === "ELEVENLABS") {
      const match = defaultElevenLabsVoice && elevenLabsVoices.some((v) => v.name === defaultElevenLabsVoice || v.voiceId === defaultElevenLabsVoice);
      return match ? defaultElevenLabsVoice : (elevenLabsVoices[0]?.name || "");
    }
    return defaultAzureVoice || defaultVoice;
  });

  const [track, setTrack] = useState<VoiceTrackDto | null>(initialVoiceTrack);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selected voice when provider changes if current voice doesn't belong to provider
  useEffect(() => {
    if (selectedProvider === "AZURE") {
      const exists = activeAzureVoices.some((v) => v.name === selectedVoice);
      if (!exists) {
        setSelectedVoice(defaultAzureVoice || activeAzureVoices[0]?.name || "ur-PK-AsadNeural");
      }
    } else {
      const exists = elevenLabsVoices.some((v) => v.name === selectedVoice || v.voiceId === selectedVoice);
      if (!exists) {
        const match = defaultElevenLabsVoice && elevenLabsVoices.some((v) => v.name === defaultElevenLabsVoice || v.voiceId === defaultElevenLabsVoice);
        if (match) {
          setSelectedVoice(defaultElevenLabsVoice);
        } else if (elevenLabsVoices.length > 0 && elevenLabsVoices[0]?.name) {
          setSelectedVoice(elevenLabsVoices[0].name);
        } else {
          setSelectedVoice("");
        }
      }
    }
  }, [selectedProvider, selectedVoice, activeAzureVoices, elevenLabsVoices, defaultAzureVoice, defaultElevenLabsVoice]);

  const isStale =
    track && directorScriptHash && track.sourceScriptHash !== directorScriptHash;

  const isCurrentProviderConfigured =
    selectedProvider === "AZURE" ? isAzureConfig : elevenLabsConfigured;

  const currentVoiceList = selectedProvider === "AZURE" ? activeAzureVoices : elevenLabsVoices;
  const canGenerate = isCurrentProviderConfigured && currentVoiceList.length > 0 && selectedVoice.trim().length > 0;

  async function handleGenerateVoice(force = false) {
    if (isGenerating || !canGenerate) return;

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/voice/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          voiceName: selectedVoice,
          force,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to generate voice narration");
      }

      setTrack(data.track);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  return (
    <Card className="p-6 bg-slate-900/60 border-slate-800 backdrop-blur-md rounded-xl space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span>🎙️</span> AIVA Voice
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Multi-provider neural text-to-speech with exact source-aligned word timing
          </p>
        </div>

        {track && (
          <Badge tone={isStale ? "warning" : "success"}>
            {isStale ? "⚠️ Narration Outdated" : "✓ Active Track"}
          </Badge>
        )}
      </div>

      {/* State 1: No Director Plan */}
      {!hasDirectorPlan && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm">
          <p className="font-semibold">Director Plan Required</p>
          <p className="mt-1 text-amber-300/80">
            Please analyze your script with AIVA Director above before generating voice narration.
          </p>
        </div>
      )}

      {/* State 2: Active / Stale / Ready Workspace */}
      {hasDirectorPlan && (
        <div className="space-y-5">
          {/* Stale warning banner */}
          {isStale && (
            <div className="p-4 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-sm flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold flex items-center gap-1.5">
                  <span>⚠️</span> Script Updated
                </p>
                <p className="mt-0.5 text-amber-300/80">
                  The script was re-analyzed in Director. Regenerate voice narration to update timing.
                </p>
              </div>
              {canGenerate && (
                <Button
                  variant="secondary"
                  className="whitespace-nowrap text-xs"
                  onClick={() => handleGenerateVoice(true)}
                  disabled={isGenerating || !canGenerate}
                >
                  {isGenerating ? "Regenerating..." : "Regenerate Now"}
                </Button>
              )}
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="p-4 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between">
              <span>{error}</span>
              <Button
                variant="secondary"
                className="text-xs"
                onClick={() => setError(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Provider Selection Tabs / Radios */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Voice Provider
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSelectedProvider("AZURE")}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border transition-all ${
                  selectedProvider === "AZURE"
                    ? "bg-indigo-600/20 border-indigo-500 text-indigo-200"
                    : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <span>🌐 Azure Speech</span>
                  {isAzureConfig ? (
                    <span className="text-xs text-emerald-400">●</span>
                  ) : (
                    <span className="text-xs text-slate-500">○</span>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedProvider("ELEVENLABS")}
                className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium border transition-all ${
                  selectedProvider === "ELEVENLABS"
                    ? "bg-indigo-600/20 border-indigo-500 text-indigo-200"
                    : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <span>⚡ ElevenLabs</span>
                  {elevenLabsConfigured ? (
                    <span className="text-xs text-emerald-400">●</span>
                  ) : (
                    <span className="text-xs text-slate-500">○</span>
                  )}
                </div>
              </button>
            </div>
          </div>

          {/* Unconfigured Provider Banner */}
          {!isCurrentProviderConfigured && (
            <div className="p-4 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 text-sm">
              <p className="font-semibold text-slate-200">
                {selectedProvider === "AZURE" ? "Azure Speech Provider Not Configured" : "ElevenLabs is not configured."}
              </p>
              <p className="mt-1 text-slate-400">
                {selectedProvider === "AZURE" ? (
                  <>
                    Configure <code className="text-indigo-300 font-mono">AZURE_SPEECH_KEY</code> and{" "}
                    <code className="text-indigo-300 font-mono">AZURE_SPEECH_REGION</code> in your environment to enable Azure narration.
                  </>
                ) : (
                  <>
                    Configure <code className="text-indigo-300 font-mono">ELEVENLABS_API_KEY</code> in your environment to enable ElevenLabs narration.
                  </>
                )}
              </p>
            </div>
          )}

          {/* Empty Voice List Notice */}
          {isCurrentProviderConfigured && currentVoiceList.length === 0 && (
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm">
              <p className="font-semibold">{`Unable to load ${selectedProvider === "ELEVENLABS" ? "ElevenLabs" : "Azure"} voices.`}</p>
              <p className="mt-1 text-amber-300/80">
                No accessible voices were returned by the provider. Please verify your API key and network connection.
              </p>
            </div>
          )}

          {/* Voice Selector & Actions */}
          {isCurrentProviderConfigured && currentVoiceList.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
              <div className="sm:col-span-2 space-y-1.5">
                <label htmlFor="voice-select" className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  {`Select ${selectedProvider === "AZURE" ? "Azure" : "ElevenLabs"} Voice`}
                </label>
                <select
                  id="voice-select"
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  disabled={isGenerating}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {currentVoiceList.map((voice) => (
                    <option key={voice.name} value={voice.name}>
                      {voice.displayName} — {voice.language} ({voice.gender})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Button
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium"
                  onClick={() => handleGenerateVoice(Boolean(track))}
                  disabled={isGenerating || !canGenerate}
                >
                  {isGenerating ? (
                    <span className="flex items-center gap-2">
                      <span className="animate-spin">⏳</span> Synthesizing...
                    </span>
                  ) : track ? (
                    "Regenerate Voice"
                  ) : (
                    "Generate Voice"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Audio Player & Track Details */}
          {track && (
            <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    {track.provider === "elevenlabs" || track.provider === "ELEVENLABS" ? "ElevenLabs" : "Azure Speech"}
                  </span>
                  <span className="text-slate-300 font-medium">
                    {VOICE_PROFILES[track.voiceName as keyof typeof VOICE_PROFILES]?.displayName || track.voiceName}
                  </span>
                  {track.model && (
                    <>
                      <span>•</span>
                      <span className="text-slate-400">{track.model}</span>
                    </>
                  )}
                  <span>•</span>
                  <span>Duration: {formatDuration(track.durationMs)} ({track.durationMs} ms)</span>
                  <span>•</span>
                  <span>Words timed: {track.boundaryCount}</span>
                </div>
                <div>
                  <span>Generated: {new Date(track.generatedAt).toLocaleTimeString()}</span>
                </div>
              </div>

              {/* Native Audio Player */}
              <audio
                controls
                className="w-full h-10 rounded"
                src={`/api/projects/${projectId}/voice/audio?t=${new Date(track.generatedAt).getTime()}`}
              >
                Your browser does not support the audio element.
              </audio>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
