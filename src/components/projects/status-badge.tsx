import { Badge } from "@/components/ui/badge";
import type { ProjectStatus } from "@/domain/project";

const TONE_BY_STATUS: Record<ProjectStatus, "neutral" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "neutral",
  SCRIPT_READY: "info",
  PLANNING: "info",
  PLAN_READY: "info",
  VOICE_GENERATING: "warning",
  VOICE_READY: "info",
  ASSETS_RESOLVING: "warning",
  ASSETS_READY: "info",
  AWAITING_AI_ASSET: "warning",
  READY_TO_RENDER: "info",
  RENDERING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={TONE_BY_STATUS[status]}>{status.replaceAll("_", " ")}</Badge>;
}
