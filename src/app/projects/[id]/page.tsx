import { notFound } from "next/navigation";
import {
  services,
  azureVoiceProvider,
  elevenLabsVoiceProvider,
  voiceProvider,
  geminiTranscribeProvider,
  azureTranscribeProvider,
  elevenLabsTranscribeProvider,
} from "@/services/container";
import { NotFoundError } from "@/domain/errors";
import { Card } from "@/components/ui/card";
import { ProjectStatusBadge } from "@/components/projects/status-badge";
import { PipelineVisualization } from "@/components/projects/pipeline-visualization";
import { DirectorWorkspace } from "@/components/director/director-workspace";
import { VoiceWorkspace } from "@/components/voice/voice-workspace";
import { AudioFirstWorkspace } from "@/components/audio-first/audio-first-workspace";
import { VOICE_PROFILES } from "@/domain/voice";
import { TimelineWorkspace } from "@/components/timeline/timeline-workspace";

export const dynamic = "force-dynamic";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { id } = await params;

  const project = await services.project.getProject(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) return null;
    throw error;
  });

  if (!project) {
    notFound();
  }

  const [plan, brands, voiceTrack, elevenLabsVoices, audioSources, activeTranscription, timeline] =
    await Promise.all([
      services.director.getPlan(id),
      services.brand.listBrands(),
      services.voice.getVoiceTrack(id).catch(() => null),
      elevenLabsVoiceProvider.listVoices().catch(() => []),
      services.transcription.getAudioSources(id).catch(() => []),
      services.transcription.getActiveTranscription(id).catch(() => null),
      services.timeline.getCurrent(id).catch(() => null),
    ]);

  const isAiConfigured = services.director.isAiConfigured();
  const isAzureConfigured = azureVoiceProvider.isConfigured();
  const isElevenLabsConfigured = elevenLabsVoiceProvider.isConfigured();

  const isGeminiTranscribeConfigured = geminiTranscribeProvider.isConfigured();
  const isAzureTranscribeConfigured = azureTranscribeProvider.isConfigured();
  const isElevenLabsSttEnabled = elevenLabsTranscribeProvider.isEnabled();
  const isElevenLabsSttConfigured = elevenLabsTranscribeProvider.isConfigured();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Project Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">{project.name}</h1>
          <p className="mt-1 text-xs text-neutral-500">Created {project.createdAt.toLocaleString()}</p>
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>

      {/* Pipeline Status */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Pipeline Stage</h2>
        <PipelineVisualization status={project.status} />
      </Card>

      {/* Audio-First (Flow B) Workspace */}
      <AudioFirstWorkspace
        projectId={id}
        initialAudioSource={audioSources[0] ?? null}
        initialTranscription={activeTranscription}
        geminiConfigured={isGeminiTranscribeConfigured}
        azureConfigured={isAzureTranscribeConfigured}
        elevenLabsSttEnabled={isElevenLabsSttEnabled}
        elevenLabsSttConfigured={isElevenLabsSttConfigured}
        brands={brands}
      />

      {/* AIVA Director Workspace */}
      <DirectorWorkspace
        project={project}
        initialPlan={plan}
        isAiConfigured={isAiConfigured}
        brands={brands}
      />

      {/* AIVA Voice Workspace */}
      {(() => {
        const isPlanUsable = plan ? (plan.sourceType === "AUDIO_TRANSCRIPT" ? Boolean(plan.isCurrent) : true) : false;
        return (
          <VoiceWorkspace
            projectId={id}
            hasDirectorPlan={isPlanUsable}
            directorScriptHash={isPlanUsable ? plan?.scriptHash : undefined}
            initialVoiceTrack={voiceTrack}
            isConfigured={isAzureConfigured}
            azureConfigured={isAzureConfigured}
            elevenLabsConfigured={isElevenLabsConfigured}
            defaultVoice={voiceProvider.defaultVoice}
            defaultAzureVoice={azureVoiceProvider.defaultVoice}
            defaultElevenLabsVoice={elevenLabsVoiceProvider.defaultVoice}
            supportedVoices={Object.values(VOICE_PROFILES)}
            azureVoices={Object.values(VOICE_PROFILES)}
            elevenLabsVoices={elevenLabsVoices}
          />
        );
      })()}

      <TimelineWorkspace
        projectId={id}
        initialTimeline={timeline}
        prerequisite={!plan ? "Generate a Director plan first" : plan.sourceType === "AUDIO_TRANSCRIPT" ? (!activeTranscription ? "Transcribe audio first" : undefined) : (!voiceTrack ? "Generate narration first" : undefined)}
      />
    </div>
  );
}
