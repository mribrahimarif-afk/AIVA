import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { VoiceWorkspace } from "@/components/voice/voice-workspace";
import { VoiceTrackDto, VoiceProfile } from "@/domain/voice";

describe("VoiceWorkspace UI Component Tests", () => {
  const mockTrack: VoiceTrackDto = {
    id: "vt_123",
    projectId: "proj_123",
    directorPlanId: "dp_123",
    sourceScriptHash: "hash_abc_123",
    provider: "azure-speech",
    model: "azure-neural",
    voiceName: "ur-PK-AsadNeural",
    locale: "ur-PK",
    outputFormat: "Riff24Khz16BitMonoPcm",
    audioSha256: "sha_xyz_789",
    audioByteCount: 125000,
    audioStorageRef: "projects/proj_123/audio/sha_xyz_789.wav",
    durationMs: 4500,
    generatedAt: new Date("2026-08-27T10:00:00Z").toISOString(),
    state: "CURRENT",
    boundaryCount: 8,
    audioUrl: "/api/projects/proj_123/voice/audio",
  };

  const mockElevenLabsTrack: VoiceTrackDto = {
    ...mockTrack,
    id: "vt_el_123",
    provider: "elevenlabs",
    model: "eleven_v3",
    voiceName: "custom_voice_abc",
  };

  const mockElevenLabsVoices: VoiceProfile[] = [
    {
      name: "custom_voice_1",
      displayName: "Custom Voice One",
      language: "Multilingual",
      locale: "multilingual",
      gender: "Female",
      description: "Custom test voice",
      provider: "ELEVENLABS",
      voiceId: "custom_voice_1",
    },
    {
      name: "custom_voice_2",
      displayName: "Custom Voice Two",
      language: "Multilingual",
      locale: "multilingual",
      gender: "Male",
      description: "Another custom test voice",
      provider: "ELEVENLABS",
      voiceId: "custom_voice_2",
    },
  ];

  it("renders 'Director Plan Required' notice when hasDirectorPlan is false", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: false,
      })
    );

    expect(html).toContain("Director Plan Required");
    expect(html).toContain("Please analyze your script with AIVA Director above");
    expect(html).not.toContain("Select Azure Voice");
  });

  it("renders 'Azure Speech Provider Not Configured' when isConfigured is false", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: false,
        azureConfigured: false,
      })
    );

    expect(html).toContain("Azure Speech Provider Not Configured");
    expect(html).toContain("AZURE_SPEECH_KEY");
    expect(html).toContain("AZURE_SPEECH_REGION");
  });

  it("renders voice selector and 'Generate Voice' button when ready and no existing track", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: true,
        azureConfigured: true,
        directorScriptHash: "hash_abc_123",
        initialVoiceTrack: null,
      })
    );

    expect(html).toContain("Select Azure Voice");
    expect(html).toContain("Asad");
    expect(html).toContain("Uzma");
    expect(html).toContain("Urdu (Pakistan)");
    expect(html).toContain("Generate Voice");
    expect(html).not.toContain("⚠️ Narration Outdated");
  });

  it("renders provider options for Azure Speech and ElevenLabs", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: true,
        azureConfigured: true,
        elevenLabsConfigured: true,
      })
    );

    expect(html).toContain("Azure Speech");
    expect(html).toContain("ElevenLabs");
  });

  it("renders audio player, duration, words timed, and 'Regenerate Voice' button when track exists", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: true,
        azureConfigured: true,
        directorScriptHash: "hash_abc_123",
        initialVoiceTrack: mockTrack,
      })
    );

    expect(html).toContain("✓ Active Track");
    expect(html).toContain("Duration:");
    expect(html).toContain("4500");
    expect(html).toContain("Words timed:");
    expect(html).toContain("8");
    expect(html).toContain("Regenerate Voice");
    expect(html).toContain("/api/projects/proj_123/voice/audio");
  });

  it("renders stale warning banner when directorScriptHash differs from track sourceScriptHash", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: true,
        azureConfigured: true,
        directorScriptHash: "hash_different_updated_script",
        initialVoiceTrack: mockTrack,
      })
    );

    expect(html).toContain("⚠️ Narration Outdated");
    expect(html).toContain("Script Updated");
    expect(html).toContain("Regenerate Now");
  });

  it("renders empty catalogue warning and disables all generation triggers when ElevenLabs discovery returns empty", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: true,
        azureConfigured: true,
        elevenLabsConfigured: true,
        initialVoiceTrack: mockElevenLabsTrack,
        elevenLabsVoices: [],
      })
    );

    expect(html).toContain("Unable to load ElevenLabs voices");
    expect(html).not.toContain("Select ElevenLabs Voice");
    expect(html).not.toContain("Regenerate Voice");
    expect(html).not.toContain("Generate Voice");
  });

  it("hides 'Regenerate Now' button in stale banner when ElevenLabs has empty catalogue", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: true,
        azureConfigured: true,
        elevenLabsConfigured: true,
        directorScriptHash: "hash_different_updated_script",
        initialVoiceTrack: mockElevenLabsTrack,
        elevenLabsVoices: [],
      })
    );

    expect(html).toContain("Script Updated");
    expect(html).not.toContain("Regenerate Now");
    expect(html).toContain("Unable to load ElevenLabs voices");
  });

  it("selects configured default voice when present in discovered catalogue", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: true,
        azureConfigured: true,
        elevenLabsConfigured: true,
        defaultElevenLabsVoice: "custom_voice_2",
        initialVoiceTrack: mockElevenLabsTrack,
        elevenLabsVoices: mockElevenLabsVoices,
      })
    );

    expect(html).toContain("Select ElevenLabs Voice");
    expect(html).toContain('value="custom_voice_2"');
    expect(html).toContain("Custom Voice Two");
  });

  it("selects first discovered voice when configured default is not in catalogue", () => {
    const html = renderToString(
      React.createElement(VoiceWorkspace, {
        projectId: "proj_123",
        hasDirectorPlan: true,
        isConfigured: true,
        azureConfigured: true,
        elevenLabsConfigured: true,
        defaultElevenLabsVoice: "non_existent_configured_voice",
        initialVoiceTrack: mockElevenLabsTrack,
        elevenLabsVoices: mockElevenLabsVoices,
      })
    );

    expect(html).toContain("Select ElevenLabs Voice");
    expect(html).toContain('value="custom_voice_1"');
    expect(html).toContain("Custom Voice One");
  });
});
