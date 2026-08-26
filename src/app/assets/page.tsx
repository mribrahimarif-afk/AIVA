import { repositories } from "@/services/container";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const count = await repositories.asset.count();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-neutral-50">Assets</h1>
      <Card>
        <p className="text-sm text-neutral-400">
          {count === 0
            ? "No assets yet. Assets are created as projects resolve stock, voice, and AI-generated media."
            : `${count} asset(s) tracked.`}
        </p>
      </Card>
    </div>
  );
}
