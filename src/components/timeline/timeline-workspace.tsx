"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TimelineDto } from "@/domain/timeline";

function time(ms: number) { const minutes = Math.floor(ms / 60000); const seconds = Math.floor((ms % 60000) / 1000); return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`; }
export function TimelineWorkspace({ projectId, initialTimeline, prerequisite }: { projectId: string; initialTimeline: TimelineDto | null; prerequisite?: string }) {
  const [timeline, setTimeline] = useState(initialTimeline); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  async function build() { setBusy(true); setError(null); try { const response = await fetch(`/api/projects/${projectId}/timeline`, { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Timeline build failed"); setTimeline(body.timeline); } catch (caught) { setError(caught instanceof Error ? caught.message : "Timeline build failed"); } finally { setBusy(false); } }
  return <Card className="p-6" data-testid="timeline-workspace"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-neutral-100">Scene Timeline</h2><p className="mt-1 text-xs text-neutral-400">{timeline ? `${timeline.timingSourceType === "VOICE_TRACK" ? "Generated Voice" : "Uploaded Audio"} · ${time(timeline.totalDurationMs)}` : prerequisite || "Build exact scene timings from the current narration."}</p></div><Button onClick={build} disabled={busy}>{busy ? "Building..." : timeline ? "Rebuild Timeline" : "Build Timeline"}</Button></div>{error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}{timeline && <div className="mt-5 space-y-2">{timeline.scenes.map((scene) => <div key={scene.sequence} className="flex items-center justify-between rounded-lg border border-neutral-800 p-3 text-sm"><span>Scene {scene.sequence}</span><span className="text-neutral-400">{time(scene.startMs)} → {time(scene.endMs)} · {(scene.durationMs / 1000).toFixed(3)}s</span></div>)}</div>}</Card>;
}
