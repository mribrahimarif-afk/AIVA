import Link from "next/link";
import { repositories } from "@/services/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateBrandModal } from "@/components/brands/create-brand-modal";

export const dynamic = "force-dynamic";

export default async function BrandsPage() {
  const brands = await repositories.brand.findAll();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">Brand Library</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Manage your brands, products, logos, media assets, and reusable library content.
          </p>
        </div>
        <CreateBrandModal />
      </div>

      {brands.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-neutral-400">No brands created yet.</p>
          <p className="mt-1 text-xs text-neutral-500">
            Create a brand to organize products, brand logos, music, SFX, and videos.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <Link key={brand.id} href={`/brands/${brand.id}`}>
              <Card className="group transition-all hover:border-neutral-700 hover:bg-neutral-900/80">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold text-neutral-100 group-hover:text-indigo-400">
                      {brand.name}
                    </h2>
                    <p className="mt-1 font-mono text-xs text-neutral-500">/{brand.slug}</p>
                  </div>
                  <Badge tone="info" className="text-xs">
                    {brand.products?.length ?? 0} Product(s)
                  </Badge>
                </div>

                <div className="mt-6 flex items-center justify-between text-xs text-neutral-400">
                  <span>Created {new Date(brand.createdAt).toLocaleDateString()}</span>
                  <span className="text-indigo-400 opacity-0 transition-opacity group-hover:opacity-100">
                    Open Brand →
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
