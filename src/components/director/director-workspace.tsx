"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SceneCard } from "./scene-card";
import type { Project } from "@/domain/project";
import type { Brand } from "@/domain/brand";
import type { DirectorPlan } from "@/domain/director";

interface DirectorWorkspaceProps {
  project: Project;
  initialPlan: DirectorPlan | null;
  isAiConfigured: boolean;
  brands: Brand[];
}

export function DirectorWorkspace({
  project,
  initialPlan,
  isAiConfigured,
  brands,
}: DirectorWorkspaceProps) {
  const [script, setScript] = useState(project.script || initialPlan?.originalScript || "");
  const [selectedBrandId, setSelectedBrandId] = useState<string>(initialPlan?.brandId || "");
  const [selectedProductId, setSelectedProductId] = useState<string>(initialPlan?.productId || "");
  const [plan, setPlan] = useState<DirectorPlan | null>(initialPlan);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter products by selected brand
  const currentBrand = brands.find((b) => b.id === selectedBrandId);
  const availableProducts = currentBrand?.products || [];

  const handleBrandChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newBrandId = e.target.value;
    setSelectedBrandId(newBrandId);
    setSelectedProductId(""); // Reset product when brand changes
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!script.trim()) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${project.id}/director/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: script.trim(),
          brandId: selectedBrandId || undefined,
          productId: selectedProductId || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to analyze script");
      }

      setPlan(data.plan);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Unconfigured Banner */}
      {!isAiConfigured && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 text-sm text-amber-200"
        >
          <div className="flex items-center gap-2 font-medium">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            Gemini AI Unconfigured
          </div>
          <p className="mt-1 text-xs text-amber-300/80">
            <code>GEMINI_API_KEY</code> is not set in the environment. Script analysis is
            currently unavailable. Set the key in <code>.env</code> to enable AIVA Director.
          </p>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-4 text-sm text-rose-200"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">Director Analysis Error</span>
            <button
              onClick={() => setError(null)}
              className="text-xs text-rose-400 hover:text-rose-300"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-1 text-xs text-rose-300/80">{error}</p>
        </div>
      )}

      {/* Script & Context Input Form */}
      <Card className="border-neutral-800 bg-neutral-900/40 p-6">
        <form onSubmit={handleAnalyze} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-neutral-100">
              AIVA Director — Script & Scene Planning
            </h2>
            <span className="text-xs text-neutral-400">
              {script.length.toLocaleString()} / 50,000 characters
            </span>
          </div>

          <div>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Paste your commercial script here (English, Urdu, Roman Urdu)..."
              rows={6}
              disabled={isAnalyzing}
              className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3.5 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
            />
          </div>

          {/* Brand & Product Selectors */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="brand-select"
                className="mb-1 block text-xs font-medium text-neutral-400"
              >
                Brand Context (Optional)
              </label>
              <select
                id="brand-select"
                value={selectedBrandId}
                onChange={handleBrandChange}
                disabled={isAnalyzing}
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
              >
                <option value="">None (Generic Script)</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="product-select"
                className="mb-1 block text-xs font-medium text-neutral-400"
              >
                Product Context (Optional)
              </label>
              <select
                id="product-select"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                disabled={isAnalyzing || !selectedBrandId}
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-neutral-600 focus:outline-none focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
              >
                <option value="">None</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="submit"
              disabled={isAnalyzing || !script.trim() || !isAiConfigured}
              className="min-w-[160px]"
            >
              {isAnalyzing
                ? "Analyzing with Gemini..."
                : plan
                ? "Re-analyze Script"
                : "Analyze Script"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Loading Skeleton */}
      {isAnalyzing && (
        <div
          data-testid="director-loading-skeleton"
          className="flex flex-col gap-4 animate-pulse"
        >
          <div className="h-28 rounded-lg bg-neutral-800/40" />
          <div className="h-44 rounded-lg bg-neutral-800/30" />
          <div className="h-44 rounded-lg bg-neutral-800/30" />
        </div>
      )}

      {/* Plan Visualization */}
      {plan && !isAnalyzing && (
        <div data-testid="director-plan-view" className="flex flex-col gap-6">
          {/* Plan Header Card */}
          <Card className="border-neutral-800 bg-neutral-900/50 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-semibold text-neutral-100">
                  Director Scene Plan
                </h3>
                <Badge tone="neutral" className="text-xs">
                  {plan.language}
                </Badge>
                <Badge tone="info" className="text-xs">
                  {plan.contentType.replace("_", " ")}
                </Badge>
              </div>

              <div className="flex items-center gap-3 text-xs text-neutral-400">
                <span>Model: {plan.model}</span>
                <span>•</span>
                <span>Scenes: {plan.scenes.length}</span>
                <span>•</span>
                <span>
                  Generated: {new Date(plan.generatedAt).toLocaleTimeString()}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 pt-4 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Summary
                </h4>
                <p className="text-sm leading-relaxed text-neutral-200">
                  {plan.summary}
                </p>
              </div>

              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Creative Direction
                </h4>
                <p className="text-sm leading-relaxed text-neutral-200">
                  {plan.creativeDirection}
                </p>
              </div>
            </div>
          </Card>

          {/* Scene Cards */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-300">
                Planned Scenes ({plan.scenes.length})
              </h3>
            </div>

            {plan.scenes.map((scene) => (
              <SceneCard key={scene.id || scene.order} scene={scene} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
