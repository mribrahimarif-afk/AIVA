import Link from "next/link";
import { notFound } from "next/navigation";
import { repositories } from "@/services/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AliasManager } from "@/components/products/alias-manager";
import { EditProductModal } from "@/components/products/edit-product-modal";
import { UploadButtonModal } from "@/components/vault/upload-button-modal";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const product = await repositories.product.findById(id);
  if (!product) {
    notFound();
  }

  const brand = await repositories.brand.findById(product.brandId);
  const assets = await repositories.asset.findByProductId(id);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Product Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/brands" className="text-xs text-neutral-400 hover:text-neutral-200">
              Brands
            </Link>
            {brand && (
              <>
                <span className="text-xs text-neutral-600">/</span>
                <Link href={`/brands/${brand.id}`} className="text-xs text-neutral-400 hover:text-neutral-200">
                  {brand.name}
                </Link>
              </>
            )}
            <span className="text-xs text-neutral-600">/</span>
            <span className="text-xs font-mono text-neutral-400">{product.slug}</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-50">{product.name}</h1>
          {product.description && (
            <p className="mt-1 text-sm text-neutral-400 max-w-2xl">{product.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <EditProductModal product={product} />
          <UploadButtonModal
            defaultRole="PRODUCT_VIDEO"
            brandId={product.brandId}
            productId={product.id}
            buttonLabel="Upload Product Video"
          />
        </div>
      </div>

      {/* Aliases Section */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-neutral-100 mb-1">Product Aliases</h2>
        <p className="text-xs text-neutral-400 mb-4">
          Aliases allow future AIVA intelligence to recognize alternate references to this product (e.g. abbreviations, Urdu/English transliterations).
        </p>

        <AliasManager productId={product.id} aliases={product.aliases} />
      </Card>

      {/* Product Video Assets Section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-100">Product Videos ({assets.length})</h2>
        </div>

        {assets.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-neutral-400">No product video assets uploaded yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {assets.map((asset) => (
              <Card key={asset.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-neutral-200 truncate">
                      {asset.title || asset.originalFilename || "Product Video"}
                    </p>
                    <p className="text-xs font-mono text-neutral-500 truncate">
                      {asset.originalFilename}
                    </p>
                  </div>
                  <Badge tone="neutral" className="text-[10px]">
                    {asset.vaultRole || asset.type}
                  </Badge>
                </div>

                <div className="mt-3 overflow-hidden rounded border border-neutral-800 bg-neutral-950 p-1">
                  <video controls src={`/api/vault/${asset.id}/content`} className="h-32 w-full object-cover rounded" />
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-500 border-t border-neutral-800/60 pt-2">
                  <span>{asset.mimeType || "video/mp4"}</span>
                  <span>{asset.sizeBytes ? `${(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : ""}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
