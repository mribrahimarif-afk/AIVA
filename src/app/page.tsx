import Link from "next/link";
import { repositories } from "@/services/container";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [projectCount, completedCount, assetCount] = await Promise.all([
    repositories.project.count(),
    repositories.project.countByStatus("COMPLETED"),
    repositories.asset.count(),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-400">Overview of your AIVA Studio workspace.</p>
        </div>
        <Link href="/projects/new">
          <Button>Create New Project</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Projects" value={projectCount} />
        <StatCard label="Completed Videos" value={completedCount} />
        <StatCard label="Assets" value={assetCount} />
      </div>
    </div>
  );
}
