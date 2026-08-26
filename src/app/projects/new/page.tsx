import { ProjectForm } from "@/components/projects/project-form";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-neutral-50">Create New Project</h1>
      <ProjectForm />
    </div>
  );
}
