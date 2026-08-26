import type { ProjectStatus } from "@/domain/project";

const STAGES = [
  { label: "Project Created", statuses: new Set<ProjectStatus>([
    "DRAFT", "SCRIPT_READY", "PLANNING", "PLAN_READY", "VOICE_GENERATING", "VOICE_READY",
    "ASSETS_RESOLVING", "ASSETS_READY", "AWAITING_AI_ASSET", "READY_TO_RENDER", "RENDERING", "COMPLETED",
  ]) },
  { label: "Scene Planning", statuses: new Set<ProjectStatus>([
    "PLANNING", "PLAN_READY", "VOICE_GENERATING", "VOICE_READY", "ASSETS_RESOLVING", "ASSETS_READY",
    "AWAITING_AI_ASSET", "READY_TO_RENDER", "RENDERING", "COMPLETED",
  ]) },
  { label: "Voice", statuses: new Set<ProjectStatus>([
    "VOICE_GENERATING", "VOICE_READY", "ASSETS_RESOLVING", "ASSETS_READY", "AWAITING_AI_ASSET",
    "READY_TO_RENDER", "RENDERING", "COMPLETED",
  ]) },
  { label: "Assets", statuses: new Set<ProjectStatus>([
    "ASSETS_RESOLVING", "ASSETS_READY", "AWAITING_AI_ASSET", "READY_TO_RENDER", "RENDERING", "COMPLETED",
  ]) },
  { label: "Editing", statuses: new Set<ProjectStatus>(["READY_TO_RENDER", "RENDERING", "COMPLETED"]) },
  { label: "Render", statuses: new Set<ProjectStatus>(["RENDERING", "COMPLETED"]) },
] as const;

/**
 * Read-only visualization of pipeline progress derived from the project's
 * current status. TASK-001 only ever reaches the "Project Created" stage;
 * later stages render as inactive placeholders until future tasks drive
 * the project through them.
 */
export function PipelineVisualization({ status }: { status: ProjectStatus }) {
  return (
    <div className="flex flex-col gap-3">
      {STAGES.map((stage) => {
        const complete = stage.statuses.has(status);
        return (
          <div key={stage.label} className="flex items-center gap-3">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                complete ? "bg-accent-500 text-white" : "border border-base-600 text-neutral-600"
              }`}
            >
              {complete ? "✓" : "○"}
            </span>
            <span className={complete ? "text-neutral-100" : "text-neutral-500"}>{stage.label}</span>
          </div>
        );
      })}
    </div>
  );
}
