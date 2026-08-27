import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { DirectorWorkspace } from "@/components/director/director-workspace";
import { SceneCard } from "@/components/director/scene-card";
import type { Project } from "@/domain/project";
import type { Brand } from "@/domain/brand";
import type { DirectorPlan, DirectorScene } from "@/domain/director";

describe("Director UI Components Tests", () => {
  const mockProject: Project = {
    id: "proj_1",
    name: "Aura Audio Launch",
    script: "Discover pure sound clarity.",
    status: "DRAFT",
    aspectRatio: "9:16",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBrands: Brand[] = [
    {
      id: "brand_1",
      name: "Aura Acoustics",
      slug: "aura-acoustics",
      createdAt: new Date(),
      updatedAt: new Date(),
      products: [
        {
          id: "prod_1",
          brandId: "brand_1",
          name: "AuraPod Max",
          slug: "aurapod-max",
          description: "High end wireless ANC headphones",
          createdAt: new Date(),
          updatedAt: new Date(),
          aliases: [],
        },
      ],
    },
  ];

  const mockScene: DirectorScene = {
    order: 1,
    text: "Experience the next level in spatial audio.",
    unitIds: ["u0001"],
    purpose: "HOOK",
    visualBrief: "Sleek metallic headphone resting on marble pedestal.",
    visualSourceHint: "PRODUCT_LIBRARY",
    shotType: "PRODUCT_HERO",
    mood: "Elevated and crisp",
    setting: "Minimalist studio",
    subject: "AuraPod Max",
    productPresence: "REQUIRED",
    searchQuery: "headphones luxury showcase",
    keywords: ["audio", "headphones", "spatial"],
    manualAiPrompt: null,
    sourceSpanStart: 0,
    sourceSpanEnd: 43,
  };

  const mockManualAiScene: DirectorScene = {
    order: 2,
    text: "Feel the soundwaves envelop your world.",
    unitIds: ["u0002"],
    purpose: "DEMONSTRATION",
    visualBrief: "Futuristic sound particles dancing around user in 3D.",
    visualSourceHint: "MANUAL_AI",
    shotType: "ABSTRACT",
    mood: "Immersive",
    setting: "Neon soundfield",
    subject: "Audio particles",
    productPresence: "NOT_NEEDED",
    searchQuery: "soundwave kinetic energy",
    keywords: ["soundwave", "neon"],
    manualAiPrompt:
      "Vivid glowing particle field pulsing with bass rhythms, slow 360 camera pan, 8k cinematic render.",
    sourceSpanStart: 44,
    sourceSpanEnd: 84,
  };

  const mockPlan: DirectorPlan = {
    id: "plan_1",
    projectId: "proj_1",
    originalScript: "Experience the next level in spatial audio. Feel the soundwaves envelop your world.",
    scriptHash: "hash-test",
    unitizerVersion: "1",
    schemaVersion: "1",
    promptVersion: "director-v1",
    model: "gemini-3.7-flash",
    language: "ENGLISH",
    contentType: "ADVERTISEMENT",
    summary: "Premium audio commercial showcasing spatial sound capabilities.",
    creativeDirection: "High-contrast minimalist lighting with futuristic audio visualizations.",
    brandId: "brand_1",
    productId: "prod_1",
    generatedAt: new Date(),
    scenes: [mockScene, mockManualAiScene],
  };

  it("renders SceneCard with standard metadata, badges, and narration", () => {
    const html = renderToString(React.createElement(SceneCard, { scene: mockScene }));

    expect(html).toContain("Experience the next level in spatial audio.");
    expect(html).toContain("HOOK");
    expect(html).toContain("PRODUCT LIBRARY");
    expect(html).toContain("Product Required");
    expect(html).toContain("PRODUCT HERO");
    expect(html).toContain("audio");
    expect(html).toContain("headphones");
  });

  it("conditionally renders manual AI video prompt only when visualSourceHint is MANUAL_AI", () => {
    const manualHtml = renderToString(
      React.createElement(SceneCard, { scene: mockManualAiScene })
    );
    expect(manualHtml).toContain("Manual AI Video Prompt (Flow / Veo / GenAI)");
    expect(manualHtml).toContain("Vivid glowing particle field pulsing with bass rhythms");

    const nonManualHtml = renderToString(
      React.createElement(SceneCard, { scene: mockScene })
    );
    expect(nonManualHtml).not.toContain("Manual AI Video Prompt (Flow / Veo / GenAI)");
  });

  it("renders unconfigured banner in DirectorWorkspace when isAiConfigured is false", () => {
    const html = renderToString(
      React.createElement(DirectorWorkspace, {
        project: mockProject,
        initialPlan: null,
        isAiConfigured: false,
        brands: mockBrands,
      })
    );

    expect(html).toContain("Gemini AI Unconfigured");
    expect(html).toContain("GEMINI_API_KEY");
  });

  it("renders DirectorWorkspace in configured state with brand options and initial plan", () => {
    const html = renderToString(
      React.createElement(DirectorWorkspace, {
        project: mockProject,
        initialPlan: mockPlan,
        isAiConfigured: true,
        brands: mockBrands,
      })
    );

    expect(html).toContain("AIVA Director");
    expect(html).toContain("Scene Planning");
    expect(html).toContain("Aura Acoustics");
    expect(html).toContain("Director Scene Plan");
    expect(html).toContain("Premium audio commercial showcasing spatial sound capabilities.");
    expect(html).toContain("Planned Scenes");
  });
});
