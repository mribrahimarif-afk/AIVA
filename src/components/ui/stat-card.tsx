import { Card } from "./card";

export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <p className="text-sm font-medium text-neutral-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-neutral-50">{value}</p>
    </Card>
  );
}
