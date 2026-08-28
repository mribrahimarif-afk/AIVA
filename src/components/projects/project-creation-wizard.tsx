"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Brand } from "@/domain/brand";
import { ASPECT_RATIOS, type AspectRatio } from "@/domain/project";
import type { TranscriptionMode } from "@/domain/transcription";
import type { VoiceProfile, VoiceProviderId } from "@/domain/voice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type CreationMode = "SCRIPT" | "VOICE";
type Stage = "IDLE" | "CREATING" | "UPLOADING" | "TRANSCRIBING" | "DIRECTING" | "SYNTHESIZING" | "TIMELINE" | "DONE";

interface ProjectCreationWizardProps {
  brands: Brand[];
  azureVoices: VoiceProfile[];
  elevenLabsVoices: VoiceProfile[];
  azureConfigured: boolean;
  elevenLabsConfigured: boolean;
  transcriptionAvailability: Record<TranscriptionMode, boolean>;
}

interface ApiFailure { error?: { message?: string } }

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & ApiFailure;
  if (!response.ok) throw new Error(body.error?.message || `Request failed (${response.status})`);
  return body;
}

const stageLabels: Partial<Record<Stage, string>> = {
  CREATING: "Creating project",
  UPLOADING: "Uploading voice",
  TRANSCRIBING: "Transcribing voice",
  DIRECTING: "Building scene plan",
  SYNTHESIZING: "Generating narration",
  TIMELINE: "Building timeline",
  DONE: "Pipeline complete",
};

export function ProjectCreationWizard(props: ProjectCreationWizardProps) {
  const router = useRouter();
  const [mode, setMode] = useState<CreationMode>("SCRIPT");
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [brandId, setBrandId] = useState("");
  const [productId, setProductId] = useState("");
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderId>("AZURE");
  const [voiceName, setVoiceName] = useState(props.azureVoices[0]?.name || "");
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>("AUTO");
  const [stage, setStage] = useState<Stage>("IDLE");
  const [completedStages, setCompletedStages] = useState<Stage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  const products = props.brands.find((brand) => brand.id === brandId)?.products ?? [];
  const voices = voiceProvider === "AZURE" ? props.azureVoices : props.elevenLabsVoices;
  const providerConfigured = voiceProvider === "AZURE" ? props.azureConfigured : props.elevenLabsConfigured;
  const busy = stage !== "IDLE" && stage !== "DONE";
  const canSubmit = mode === "SCRIPT"
    ? Boolean(name.trim() && script.trim() && providerConfigured && voiceName && props.transcriptionAvailability[transcriptionMode] && !busy)
    : Boolean(name.trim() && audio && props.transcriptionAvailability[transcriptionMode] && !busy);

  const pipelineStages = useMemo<Stage[]>(
    () => mode === "SCRIPT"
      ? ["CREATING", "DIRECTING", "SYNTHESIZING", "TRANSCRIBING", "TIMELINE", "DONE"]
      : ["CREATING", "UPLOADING", "TRANSCRIBING", "DIRECTING", "TIMELINE", "DONE"],
    [mode]
  );

  function changeProvider(provider: VoiceProviderId) {
    setVoiceProvider(provider);
    const providerVoices = provider === "AZURE" ? props.azureVoices : props.elevenLabsVoices;
    setVoiceName(providerVoices[0]?.name || "");
  }

  function markComplete(current: Stage, next: Stage) {
    setCompletedStages((items) => [...items, current]);
    setStage(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setCreatedProjectId(null);
    setCompletedStages([]);
    setStage("CREATING");

    let projectId: string | null = null;
    try {
      const created = await readResponse(await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, script: mode === "SCRIPT" ? script : "", aspectRatio }),
      }));
      projectId = (created.project as { id: string }).id;
      setCreatedProjectId(projectId);

      if (mode === "SCRIPT") {
        markComplete("CREATING", "DIRECTING");
        await readResponse(await fetch(`/api/projects/${projectId}/director/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ script, brandId: brandId || undefined, productId: productId || undefined }),
        }));

        markComplete("DIRECTING", "SYNTHESIZING");
        await readResponse(await fetch(`/api/projects/${projectId}/voice/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: voiceProvider, voiceName }),
        }));
        markComplete("SYNTHESIZING", "TRANSCRIBING");
        const narrationResponse = await fetch(`/api/projects/${projectId}/voice/audio`);
        if (!narrationResponse.ok) await readResponse(narrationResponse);
        const narration = await narrationResponse.blob();
        const narrationUpload = new FormData();
        narrationUpload.append("file", new File([narration], "generated-narration.wav", { type: narration.type || "audio/wav" }));
        const uploaded = await readResponse(await fetch(`/api/projects/${projectId}/audio-source`, { method: "POST", body: narrationUpload }));
        const generatedAudioSourceId = (uploaded.audioSource as { id: string }).id;
        await readResponse(await fetch(`/api/projects/${projectId}/transcription`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audioSourceId: generatedAudioSourceId, mode: transcriptionMode }),
        }));
        markComplete("TRANSCRIBING", "TIMELINE");
        await readResponse(await fetch(`/api/projects/${projectId}/timeline`, { method: "POST" }));
        markComplete("TIMELINE", "DONE");
      } else {
        markComplete("CREATING", "UPLOADING");
        const uploadBody = new FormData();
        uploadBody.append("file", audio as File);
        const uploaded = await readResponse(await fetch(`/api/projects/${projectId}/audio-source`, {
          method: "POST",
          body: uploadBody,
        }));
        const audioSourceId = (uploaded.audioSource as { id: string }).id;

        markComplete("UPLOADING", "TRANSCRIBING");
        const transcribed = await readResponse(await fetch(`/api/projects/${projectId}/transcription`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioSourceId, mode: transcriptionMode }),
        }));
        const transcriptionId = (transcribed.transcription as { id: string }).id;

        markComplete("TRANSCRIBING", "DIRECTING");
        await readResponse(await fetch(`/api/projects/${projectId}/transcription/${transcriptionId}/use-with-director`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brandId: brandId || undefined, productId: productId || undefined }),
        }));
        markComplete("DIRECTING", "TIMELINE");
        await readResponse(await fetch(`/api/projects/${projectId}/timeline`, { method: "POST" }));
        markComplete("TIMELINE", "DONE");
      }

      router.push(`/projects/${projectId}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The pipeline failed unexpectedly.");
      setStage("IDLE");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" data-testid="project-creation-wizard">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["SCRIPT", "VOICE"] as const).map((value) => (
          <button key={value} type="button" disabled={busy} onClick={() => setMode(value)}
            className={`rounded-xl border p-5 text-left transition ${mode === value ? "border-accent-500 bg-accent-500/10" : "border-base-700 bg-base-850 hover:border-base-600"}`}>
            <span className="block font-semibold text-neutral-100">{value === "SCRIPT" ? "Via Script" : "Via Voice"}</span>
            <span className="mt-1 block text-xs text-neutral-400">{value === "SCRIPT" ? "Plan scenes and generate narration in one click." : "Upload narration, transcribe it, and plan scenes in one click."}</span>
          </button>
        ))}
      </div>

      <Card className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-neutral-300">Project Name<Input className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required /></label>
          <div><span className="mb-1.5 block text-sm text-neutral-300">Aspect Ratio</span><div className="flex gap-2">{ASPECT_RATIOS.map((ratio) => <button key={ratio} type="button" onClick={() => setAspectRatio(ratio)} className={`rounded-lg border px-3 py-2 text-sm ${aspectRatio === ratio ? "border-accent-500 text-accent-400" : "border-base-700 text-neutral-400"}`}>{ratio}</button>)}</div></div>
        </div>

        {mode === "SCRIPT" ? (
          <label className="block text-sm text-neutral-300">Script<Textarea className="mt-1.5" rows={9} maxLength={50000} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Paste or write your script..." required /></label>
        ) : (
          <label className="block text-sm text-neutral-300">Narration Audio<input className="mt-2 block w-full text-sm text-neutral-400 file:mr-4 file:rounded-md file:border-0 file:bg-neutral-800 file:px-4 file:py-2 file:text-neutral-200" type="file" accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.webm" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} required /></label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-neutral-300">Brand (Optional)<select className="mt-1.5 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm" value={brandId} onChange={(e) => { setBrandId(e.target.value); setProductId(""); }}><option value="">None</option>{props.brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
          <label className="text-sm text-neutral-300">Product (Optional)<select className="mt-1.5 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm" value={productId} disabled={!brandId} onChange={(e) => setProductId(e.target.value)}><option value="">None</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        </div>

        {mode === "SCRIPT" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-neutral-300">Voice Provider<select className="mt-1.5 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm" value={voiceProvider} onChange={(e) => changeProvider(e.target.value as VoiceProviderId)}><option value="AZURE">Azure Speech</option><option value="ELEVENLABS">ElevenLabs</option></select></label>
            <label className="text-sm text-neutral-300">Voice<select className="mt-1.5 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm" value={voiceName} disabled={!providerConfigured || voices.length === 0} onChange={(e) => setVoiceName(e.target.value)}><option value="">Select a discovered voice</option>{voices.map((voice) => <option key={voice.voiceId || voice.name} value={voice.name}>{voice.displayName} — {voice.language}</option>)}</select></label>
            {!providerConfigured || voices.length === 0 ? <p className="sm:col-span-2 text-xs text-amber-300">{voiceProvider === "ELEVENLABS" ? "ElevenLabs is unavailable or its voice catalogue could not be loaded." : "Azure Speech is not configured."}</p> : null}
            <label className="text-sm text-neutral-300 sm:col-span-2">Narration Transcription Provider<select className="mt-1.5 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm" value={transcriptionMode} onChange={(e) => setTranscriptionMode(e.target.value as TranscriptionMode)}>{(["AUTO", "GEMINI", "AZURE", "ELEVENLABS"] as TranscriptionMode[]).map((item) => <option key={item} value={item} disabled={!props.transcriptionAvailability[item]}>{item}{!props.transcriptionAvailability[item] ? " (unavailable)" : ""}</option>)}</select></label>
          </div>
        ) : (
          <label className="block text-sm text-neutral-300">Transcription Provider<select className="mt-1.5 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm" value={transcriptionMode} onChange={(e) => setTranscriptionMode(e.target.value as TranscriptionMode)}>{(["AUTO", "GEMINI", "AZURE", "ELEVENLABS"] as TranscriptionMode[]).map((item) => <option key={item} value={item} disabled={!props.transcriptionAvailability[item]}>{item}{!props.transcriptionAvailability[item] ? " (unavailable)" : ""}</option>)}</select></label>
        )}
      </Card>

      {pipelineStages.some((item) => item === stage || completedStages.includes(item)) && <div className="flex flex-wrap gap-2" aria-live="polite">{pipelineStages.map((item) => <span key={item} className={`rounded-full border px-3 py-1 text-xs ${item === stage ? "border-accent-500 text-accent-300" : completedStages.includes(item) || (item === "DONE" && stage === "DONE") ? "border-emerald-600 text-emerald-300" : "border-neutral-800 text-neutral-500"}`}>{stageLabels[item]}</span>)}</div>}
      {error && <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-4 text-sm text-rose-200"><p>{error}</p>{createdProjectId && <button type="button" className="mt-2 text-xs underline" onClick={() => router.push(`/projects/${createdProjectId}`)}>Open the created project to retry</button>}</div>}
      <div className="flex justify-end"><Button type="submit" disabled={!canSubmit}>{busy ? stageLabels[stage] + "..." : mode === "SCRIPT" ? "Create & Generate" : "Create & Process Voice"}</Button></div>
    </form>
  );
}
