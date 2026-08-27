"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  SupportedVoice,
  VoiceProfile,
  VoiceTrackDto,
  VOICE_PROFILES,
} from "@/domain/voice";

interface VoiceWorkspaceProps {
  projectId: string;
  hasDirectorPlan: boolean;
  directorScriptHash?: string;
  initialVoiceTrack?: VoiceTrackDto | null;
  isConfigured?: boolean;
  defaultVoice?: string;
  supportedVoices?: VoiceProfile[];
}

export function VoiceWorkspace({
  projectId,
  hasDirectorPlan,
  directorScriptHash,
  initialVoiceTrack = null,
  isConfigured = true,
  defaultVoice = "ur-PK-AsadNeural",
  supportedVoices = Object.values(VOICE_PROFILES),
}: VoiceWorkspaceProps) {
  const [selectedVoice, setSelectedVoice] = useState<SupportedVoice>(
    (initialVoiceTrack?.voiceName as SupportedVoice) || (defaultVoice as SupportedVoice)
  );
  const [track, setTrack] = useState<VoiceTrackDto | null>(initialVoiceTrack);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStale =
    track && directorScriptHash && track.sourceScriptHash !== directorScriptHash;

  async function handleGenerateVoice(force = false) {
    if (isGenerating) return;

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/voice/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
            Azure Neural text-to-speech with exact source-aligned word timing
          </p>
        </div>

        {track && (
          <Badge
            tone={isStale ? "warning" : "success"}
          >
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

      {/* State 2: Unconfigured Provider */}
      {hasDirectorPlan && !isConfigured && (
        <div className="p-4 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300 text-sm">
          <p className="font-semibold text-slate-200">Azure Speech Provider Not Configured</p>
          <p className="mt-1 text-slate-400">
            Configure <code className="text-indigo-300 font-mono">AZURE_SPEECH_KEY</code> and{" "}
            <code className="text-indigo-300 font-mono">AZURE_SPEECH_REGION</code> in your environment to enable neural narration.
          </p>
        </div>
      )}

      {/* State 3: Active / Stale / Ready Workspace */}
      {hasDirectorPlan && isConfigured && (
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
              <Button
                variant="secondary"
                className="whitespace-nowrap text-xs"
                onClick={() => handleGenerateVoice(true)}
                disabled={isGenerating}
              >
                {isGenerating ? "Regenerating..." : "Regenerate Now"}
              </Button>
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

          {/* Voice Selector & Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="sm:col-span-2 space-y-1.5">
              <label htmlFor="voice-select" className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Select Neural Voice
              </label>
              <select
                id="voice-select"
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value as SupportedVoice)}
                disabled={isGenerating}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {supportedVoices.map((voice) => (
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
                disabled={isGenerating}
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

          {/* Audio Player & Track Details */}
          {track && (
            <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="text-slate-300 font-medium">
                    {VOICE_PROFILES[track.voiceName as SupportedVoice]?.displayName || track.voiceName}
                  </span>
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
