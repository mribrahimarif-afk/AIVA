"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ASPECT_RATIOS, type AspectRatio } from "@/domain/project";

interface ApiErrorBody {
  error?: {
    message?: string;
    details?: { fieldErrors?: Record<string, string> };
  };
}

export function ProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [script, setScript] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, script, aspectRatio }),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        const errorBody = body as ApiErrorBody;
        setFieldErrors(errorBody.error?.details?.fieldErrors ?? {});
        setFormError(errorBody.error?.message ?? "Failed to create project");
        return;
      }

      const { project } = body as { project: { id: string } };
      router.push(`/projects/${project.id}`);
    } catch {
      setFormError("Failed to reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-neutral-300">
            Project Name
          </label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My first video"
            required
          />
          {fieldErrors.name ? <p className="mt-1 text-xs text-red-400">{fieldErrors.name}</p> : null}
        </div>

        <div>
          <label htmlFor="script" className="mb-1.5 block text-sm font-medium text-neutral-300">
            Script
          </label>
          <Textarea
            id="script"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Paste or write your script here..."
            rows={8}
          />
          {fieldErrors.script ? <p className="mt-1 text-xs text-red-400">{fieldErrors.script}</p> : null}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-neutral-300">Aspect Ratio</span>
          <div className="flex gap-2">
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => setAspectRatio(ratio)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  aspectRatio === ratio
                    ? "border-accent-500 bg-accent-500/15 text-accent-400"
                    : "border-base-700 bg-base-850 text-neutral-300 hover:border-base-600"
                }`}
              >
                {ratio}
              </button>
            ))}
          </div>
          {fieldErrors.aspectRatio ? (
            <p className="mt-1 text-xs text-red-400">{fieldErrors.aspectRatio}</p>
          ) : null}
        </div>

        {formError ? <p className="text-sm text-red-400">{formError}</p> : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Project"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
