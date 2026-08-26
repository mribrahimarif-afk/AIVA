import Link from "next/link";
import { notFound } from "next/navigation";
import { repositories } from "@/services/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateProductModal } from "@/components/products/create-product-modal";
import { UploadButtonModal } from "@/components/vault/upload-button-modal";

export const dynamic = "force-dynamic";

export default async function BrandDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const brand = await repositories.brand.findById(id);
  if (!brand) {
    notFound();
  }

  const products = await repositories.product.findByBrandId(id);
  const assets = await repositories.asset.findByBrandId(id);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Brand Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/brands" className="text-xs text-neutral-400 hover:text-neutral-200">
              ← Brands
            </Link>
            <span className="text-xs text-neutral-600">/</span>
            <span className="text-xs font-mono text-neutral-400">{brand.slug}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-50">{brand.name}</h1>
          <p className="mt-1 text-xs text-neutral-500">
            Created {new Date(brand.createdAt).toLocaleDateString()}
          </p>
        </div>

        <div className="flex gap-3">
          <UploadButtonModal brandId={brand.id} buttonLabel="Upload Brand Asset" />
          <CreateProductModal brandId={brand.id} brandName={brand.name} />
        </div>
      </div>

      {/* Products Section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-100">Products ({products.length})</h2>
        </div>

        {products.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-neutral-400">No products created for this brand yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <Link key={product.id} href={`/products/${product.id}`}>
                <Card className="group transition-all hover:border-neutral-700 hover:bg-neutral-900/80">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-neutral-100 group-hover:text-indigo-400">
                        {product.name}
                      </h3>
                      <p className="mt-1 font-mono text-xs text-neutral-500">/{product.slug}</p>
                    </div>
                    <Badge tone="info" className="text-xs">
                      {product.aliases?.length ?? 0} Alias(es)
                    </Badge>
                  </div>
                  {product.description && (
                    <p className="mt-3 text-xs text-neutral-400 line-clamp-2">
                      {product.description}
                    </p>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Brand Assets Section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-100">Brand Assets ({assets.length})</h2>
        </div>

        {assets.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-neutral-400">No assets uploaded for this brand yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => (
              <Card key={asset.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-200 truncate">
                      {asset.title || asset.originalFilename || "Asset"}
                    </p>
                    <p className="text-xs font-mono text-neutral-500 truncate">
                      {asset.originalFilename}
                    </p>
                  </div>
                  <Badge tone="neutral" className="text-[10px]">
                    {asset.vaultRole || asset.type}
                  </Badge>
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-500 border-t border-neutral-800/60 pt-2">
                  <span>{asset.mimeType || "unknown"}</span>
                  <span>{asset.sizeBytes ? `${(asset.sizeBytes / 1024).toFixed(0)} KB` : ""}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
