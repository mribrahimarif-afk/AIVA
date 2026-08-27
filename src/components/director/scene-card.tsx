"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DirectorScene } from "@/domain/director";

interface SceneCardProps {
  scene: DirectorScene;
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function SceneCard({ scene }: SceneCardProps) {
  const isManualAi = scene.visualSourceHint === "MANUAL_AI";

  const getSourceBadgeTone = (source: string): BadgeTone => {
    switch (source) {
      case "PRODUCT_LIBRARY":
        return "success";
      case "REUSABLE_LIBRARY":
        return "info";
      case "STOCK":
        return "neutral";
      case "MANUAL_AI":
        return "warning";
      default:
        return "neutral";
    }
  };

  const getPurposeBadgeTone = (purpose: string): BadgeTone => {
    switch (purpose) {
      case "HOOK":
        return "warning";
      case "PROBLEM":
        return "danger";
      case "PRODUCT":
      case "DEMONSTRATION":
        return "success";
      case "CTA":
        return "info";
      default:
        return "neutral";
    }
  };

  return (
    <Card className="flex flex-col gap-4 border-neutral-800 bg-neutral-900/60 p-5 transition-colors hover:border-neutral-700">
      {/* Header with Scene Order & Status Badges */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800 text-xs font-bold text-neutral-200">
            {scene.order}
          </span>
          <Badge tone={getPurposeBadgeTone(scene.purpose)} className="text-xs">
            {scene.purpose}
          </Badge>
          <Badge tone={getSourceBadgeTone(scene.visualSourceHint)} className="text-xs">
            {scene.visualSourceHint.replace("_", " ")}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {scene.productPresence === "REQUIRED" && (
            <Badge tone="success" className="text-xs">
              Product Required
            </Badge>
          )}
          {scene.productPresence === "PREFERRED" && (
            <Badge tone="neutral" className="text-xs">
              Product Preferred
            </Badge>
          )}
          <span className="text-xs text-neutral-400">
            {scene.shotType.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Narration Section */}
      <div className="rounded-md border border-neutral-800 bg-neutral-950/70 p-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Narration (Script Slice)
        </div>
        <p className="text-sm font-medium leading-relaxed text-neutral-100">
          {scene.text}
        </p>
      </div>

      {/* Visual Brief */}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Visual Action
        </div>
        <p className="text-sm text-neutral-300">{scene.visualBrief}</p>
      </div>

      {/* Context Tags */}
      <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        {scene.mood && (
          <div className="rounded bg-neutral-800/50 p-2">
            <span className="font-medium text-neutral-400">Mood: </span>
            <span className="text-neutral-200">{scene.mood}</span>
          </div>
        )}
        {scene.setting && (
          <div className="rounded bg-neutral-800/50 p-2">
            <span className="font-medium text-neutral-400">Setting: </span>
            <span className="text-neutral-200">{scene.setting}</span>
          </div>
        )}
        {scene.subject && (
          <div className="rounded bg-neutral-800/50 p-2">
            <span className="font-medium text-neutral-400">Subject: </span>
            <span className="text-neutral-200">{scene.subject}</span>
          </div>
        )}
      </div>

      {/* Search Query & Keywords */}
      <div className="flex flex-col gap-2 rounded border border-neutral-800/60 bg-neutral-950/40 p-2.5 text-xs">
        <div>
          <span className="font-semibold text-neutral-400">Search Query: </span>
          <span className="italic text-neutral-200">{scene.searchQuery}</span>
        </div>
        {scene.keywords.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="font-semibold text-neutral-400">Keywords:</span>
            {scene.keywords.map((kw, i) => (
              <span
                key={i}
                className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-300"
              >
                #{kw}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Manual AI Prompt (Conditional) */}
      {isManualAi && scene.manualAiPrompt && (
        <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Manual AI Video Prompt (Flow / Veo / GenAI)
            </span>
          </div>
          <p className="text-xs leading-relaxed text-amber-200/90 selection:bg-amber-500/30">
            {scene.manualAiPrompt}
          </p>
        </div>
      )}
    </Card>
  );
}
