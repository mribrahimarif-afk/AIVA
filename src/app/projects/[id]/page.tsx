import { notFound } from "next/navigation";
import { services } from "@/services/container";
import { NotFoundError } from "@/domain/errors";
import { Card } from "@/components/ui/card";
import { ProjectStatusBadge } from "@/components/projects/status-badge";
import { PipelineVisualization } from "@/components/projects/pipeline-visualization";

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

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">{project.name}</h1>
          <p className="mt-1 text-xs text-neutral-500">Created {project.createdAt.toLocaleString()}</p>
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">Script</h2>
          {project.script ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">{project.script}</p>
          ) : (
            <p className="text-sm text-neutral-500">No script provided yet.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-medium text-neutral-400">Pipeline</h2>
          <PipelineVisualization status={project.status} />
        </Card>
      </div>
    </div>
  );
}
