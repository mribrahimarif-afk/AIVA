import { prisma } from "@/infrastructure/db/client";
import { createProjectRepository } from "@/repositories/project.repository";
import { createBrandRepository } from "@/repositories/brand.repository";
import { createProductRepository } from "@/repositories/product.repository";
import { createContentBlobRepository } from "@/repositories/content-blob.repository";
import { createSceneRepository } from "@/repositories/scene.repository";
import { createDirectorPlanRepository } from "@/repositories/director-plan.repository";
import { createAssetRepository } from "@/repositories/asset.repository";
import { GeminiDirectorProvider } from "@/providers/ai/gemini-director.provider";
import { OpenRouterDirectorProvider } from "@/providers/ai/openrouter-director.provider";
import { ResilientDirectorProvider } from "@/providers/ai/resilient-director.provider";
import { getEnv } from "@/infrastructure/config/env";
import { logger } from "@/infrastructure/logging/logger";
import { createProjectService } from "./project.service";
import { createBrandService } from "./brand.service";
import { createProductService } from "./product.service";
import { createVaultService } from "./vault.service";
import { createHealthService } from "./health.service";
import { createDirectorService } from "./director.service";

import { createVoiceTrackRepository } from "@/repositories/voice-track.repository";
import { createAudioSourceRepository } from "@/repositories/audio-source.repository";
import { createTranscriptionRepository } from "@/repositories/transcription.repository";
import { AzureVoiceProvider } from "@/providers/voice/azure-voice.provider";
import { ElevenLabsVoiceProvider } from "@/providers/voice/elevenlabs-voice.provider";
import { voiceStorageService } from "@/storage/voice-storage.service";
import { audioSourceStorageService } from "@/storage/audio-source-storage.service";
import { GeminiTranscribeProvider } from "@/providers/transcription/gemini-transcribe.provider";
import { AzureTranscribeProvider } from "@/providers/transcription/azure-transcribe.provider";
import { ElevenLabsTranscribeProvider } from "@/providers/transcription/elevenlabs-transcribe.provider";
import { ResilientTranscribeProvider } from "@/providers/transcription/resilient-transcribe.provider";
import { VoiceService } from "./voice.service";
import { TranscriptionService } from "./transcription.service";
import { createTimelineRepository } from "@/repositories/timeline.repository";
import { TimelineService } from "./timeline.service";

/**
 * Composition root wiring Prisma-backed repositories to application services.
 */
export const repositories = {
  project: createProjectRepository(prisma),
  brand: createBrandRepository(prisma),
  product: createProductRepository(prisma),
  contentBlob: createContentBlobRepository(prisma),
  scene: createSceneRepository(prisma),
  directorPlan: createDirectorPlanRepository(prisma),
  voiceTrack: createVoiceTrackRepository(prisma),
  audioSource: createAudioSourceRepository(prisma),
  transcription: createTranscriptionRepository(prisma),
  timeline: createTimelineRepository(prisma),
  asset: createAssetRepository(prisma),
};

const env = getEnv();
export const geminiDirectorProvider = new GeminiDirectorProvider({
  apiKey: env.GEMINI_API_KEY,
  model: env.GEMINI_MODEL,
  fallbackModel: env.GEMINI_DIRECTOR_FALLBACK_MODEL,
  timeoutMs: env.GEMINI_TIMEOUT_MS,
  logger,
});

export const openRouterDirectorProvider = new OpenRouterDirectorProvider({
  apiKey: env.OPENROUTER_API_KEY,
  model: env.OPENROUTER_DIRECTOR_MODEL,
  timeoutMs: env.OPENROUTER_TIMEOUT_MS,
  logger,
});

export const directorAiProvider = new ResilientDirectorProvider({
  geminiProvider: geminiDirectorProvider,
  openRouterProvider: openRouterDirectorProvider,
  logger,
});

export const azureVoiceProvider = new AzureVoiceProvider({
  apiKey: env.AZURE_SPEECH_KEY,
  region: env.AZURE_SPEECH_REGION,
  timeoutMs: env.VOICE_SYNTHESIS_TIMEOUT_MS,
});

export const elevenLabsVoiceProvider = new ElevenLabsVoiceProvider({
  apiKey: env.ELEVENLABS_API_KEY,
  modelId: env.ELEVENLABS_MODEL_ID,
  defaultVoiceId: env.ELEVENLABS_DEFAULT_VOICE_ID,
  timeoutMs: env.ELEVENLABS_TIMEOUT_MS,
});

// Transcription Providers (TASK-004B Audio-First)
export const geminiTranscribeProvider = new GeminiTranscribeProvider({
  apiKey: env.GEMINI_API_KEY,
  model: env.GEMINI_TRANSCRIBE_MODEL,
  timeoutMs: env.GEMINI_TRANSCRIBE_TIMEOUT_MS,
  logger,
});

export const azureTranscribeProvider = new AzureTranscribeProvider({
  apiKey: env.AZURE_SPEECH_KEY,
  region: env.AZURE_SPEECH_REGION,
  timeoutMs: env.AZURE_TRANSCRIBE_TIMEOUT_MS,
  logger,
});

export const elevenLabsTranscribeProvider = new ElevenLabsTranscribeProvider({
  apiKey: env.ELEVENLABS_STT_API_KEY || env.ELEVENLABS_API_KEY,
  enabled: env.ELEVENLABS_STT_ENABLED,
  modelId: env.ELEVENLABS_STT_MODEL_ID,
  timeoutMs: env.ELEVENLABS_STT_TIMEOUT_MS,
  logger,
});

export const resilientTranscribeProvider = new ResilientTranscribeProvider({
  geminiProvider: geminiTranscribeProvider,
  azureProvider: azureTranscribeProvider,
  elevenLabsProvider: elevenLabsTranscribeProvider,
  logger,
});

// Backward-compatible alias for existing imports
export const voiceProvider = azureVoiceProvider;

const directorServiceInstance = createDirectorService({
  directorPlanRepository: repositories.directorPlan,
  projectRepository: repositories.project,
  brandRepository: repositories.brand,
  productRepository: repositories.product,
  audioSourceRepository: repositories.audioSource,
  transcriptionRepository: repositories.transcription,
  directorAiProvider,
  logger,
  maxScriptChars: env.DIRECTOR_MAX_SCRIPT_CHARS,
});

const transcriptionServiceInstance = new TranscriptionService({
  projectRepository: repositories.project,
  audioSourceRepository: repositories.audioSource,
  transcriptionRepository: repositories.transcription,
  audioSourceStorageService,
  transcriptionProvider: resilientTranscribeProvider,
  directorService: directorServiceInstance,
  logger,
  maxAudioBytes: env.TRANSCRIBE_MAX_AUDIO_BYTES,
  runtimeSemantics: {
    geminiModel: geminiTranscribeProvider.modelName,
    azureModel: azureTranscribeProvider.modelName,
    elevenLabsModel: elevenLabsTranscribeProvider.modelName,
    routingPolicyVersion: "v1",
    canonicalBuilderVersion: "v1",
    languageHints: [],
    vocabularyHash: null,
  },
});

export const services = {
  project: createProjectService({ projectRepository: repositories.project, db: prisma }),
  brand: createBrandService(repositories.brand),
  product: createProductService(repositories.product, repositories.brand),
  vault: createVaultService(
    repositories.asset,
    repositories.contentBlob,
    repositories.brand,
    repositories.product
  ),
  health: createHealthService(prisma),
  director: directorServiceInstance,
  voice: new VoiceService({
    projectRepository: repositories.project,
    directorPlanRepository: repositories.directorPlan,
    voiceTrackRepository: repositories.voiceTrack,
    audioSourceRepository: repositories.audioSource,
    transcriptionRepository: repositories.transcription,
    voiceProvider: azureVoiceProvider,
    voiceProviders: {
      "azure-speech": azureVoiceProvider,
      azure: azureVoiceProvider,
      elevenlabs: elevenLabsVoiceProvider,
    },
    voiceStorageService,
  }),
  transcription: transcriptionServiceInstance,
  timeline: new TimelineService({
    projectRepository: repositories.project,
    directorPlanRepository: repositories.directorPlan,
    voiceTrackRepository: repositories.voiceTrack,
    audioSourceRepository: repositories.audioSource,
    transcriptionRepository: repositories.transcription,
    timelineRepository: repositories.timeline,
  }),
};
