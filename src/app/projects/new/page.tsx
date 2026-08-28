import { ProjectCreationWizard } from "@/components/projects/project-creation-wizard";
import { VOICE_PROFILES } from "@/domain/voice";
import {
  services,
  azureVoiceProvider,
  elevenLabsVoiceProvider,
  geminiTranscribeProvider,
  azureTranscribeProvider,
  elevenLabsTranscribeProvider,
} from "@/services/container";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const [brands, elevenLabsVoices] = await Promise.all([
    services.brand.listBrands(),
    elevenLabsVoiceProvider.listVoices().catch(() => []),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">Create New Project</h1>
      <p className="mb-8 mt-2 text-sm text-neutral-400">Choose a source and let AIVA run the ready-to-use pipeline.</p>
      <ProjectCreationWizard
        brands={brands}
        azureVoices={Object.values(VOICE_PROFILES)}
        elevenLabsVoices={elevenLabsVoices}
        azureConfigured={azureVoiceProvider.isConfigured()}
        elevenLabsConfigured={elevenLabsVoiceProvider.isConfigured()}
        transcriptionAvailability={{
          AUTO: geminiTranscribeProvider.isConfigured() || azureTranscribeProvider.isConfigured(),
          GEMINI: geminiTranscribeProvider.isConfigured(),
          AZURE: azureTranscribeProvider.isConfigured(),
          ELEVENLABS: elevenLabsTranscribeProvider.isEnabled() && elevenLabsTranscribeProvider.isConfigured(),
        }}
      />
    </div>
  );
}
