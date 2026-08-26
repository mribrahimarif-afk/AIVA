import { repositories } from "@/services/container";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const brands = await repositories.brand.findAll();

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-neutral-50">Brands</h1>

      {brands.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-400">No brands yet.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {brands.map((brand) => (
            <Card key={brand.id}>
              <p className="font-medium text-neutral-100">{brand.name}</p>
              <p className="mt-1 text-xs text-neutral-500">/{brand.slug}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
