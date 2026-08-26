import Link from "next/link";
import { repositories } from "@/services/container";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProjectStatusBadge } from "@/components/projects/status-badge";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const projects = await repositories.project.findAll();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">Projects</h1>
        <Link href="/projects/new">
          <Button>Create New Project</Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">No projects yet. Create your first one to get started.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="transition-colors hover:border-accent-500/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-neutral-100">{project.name}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {project.aspectRatio} &middot; created {project.createdAt.toLocaleDateString()}
                    </p>
                  </div>
                  <ProjectStatusBadge status={project.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
