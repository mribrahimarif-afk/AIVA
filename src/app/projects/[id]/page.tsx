import { notFound } from "next/navigation";
import { services } from "@/services/container";
import { NotFoundError } from "@/domain/errors";
import { Card } from "@/components/ui/card";
import { ProjectStatusBadge } from "@/components/projects/status-badge";
import { PipelineVisualization } from "@/components/projects/pipeline-visualization";
import { DirectorWorkspace } from "@/components/director/director-workspace";

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

  const [plan, brands] = await Promise.all([
    services.director.getPlan(id),
    services.brand.listBrands(),
  ]);

  const isAiConfigured = services.director.isAiConfigured();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Project Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">{project.name}</h1>
          <p className="mt-1 text-xs text-neutral-500">Created {project.createdAt.toLocaleString()}</p>
        </div>
        <ProjectStatusBadge status={project.status} />
      </div>

      {/* Pipeline Status */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-medium text-neutral-400">Pipeline Stage</h2>
        <PipelineVisualization status={project.status} />
      </Card>

      {/* AIVA Director Workspace */}
      <DirectorWorkspace
        project={project}
        initialPlan={plan}
        isAiConfigured={isAiConfigured}
        brands={brands}
      />
    </div>
  );
}
