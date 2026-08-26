import Link from "next/link";
import { repositories } from "@/services/container";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UploadButtonModal } from "@/components/vault/upload-button-modal";
import type { VaultRole } from "@/domain/asset";

export const dynamic = "force-dynamic";

export default async function AssetsPage(props: {
  searchParams?: Promise<{ role?: string; brandId?: string; productId?: string }>;
}) {
  const params = (await props.searchParams) || {};
  const selectedRole = (params.role as VaultRole) || undefined;
  const selectedBrandId = params.brandId || undefined;
  const selectedProductId = params.productId || undefined;

  const assets = await repositories.asset.filterVault({
    role: selectedRole,
    brandId: selectedBrandId,
    productId: selectedProductId,
  });

  const brands = await repositories.brand.findAll();
  const products = selectedBrandId
    ? await repositories.product.findByBrandId(selectedBrandId)
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-50">AIVA Vault</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Permanent local media asset library with SHA-256 binary content deduplication.
          </p>
        </div>
        <UploadButtonModal buttonLabel="Upload Asset" />
      </div>

      {/* Filter Toolbar */}
      <Card className="p-4 bg-neutral-900 border-neutral-800">
        <form method="GET" className="flex flex-wrap items-center gap-4">
          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">
              Vault Role
            </label>
            <select
              name="role"
              defaultValue={selectedRole || ""}
              className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All Roles</option>
              <option value="BRAND_LOGO">Brand Logo</option>
              <option value="PRODUCT_VIDEO">Product Video</option>
              <option value="MUSIC">Music Track</option>
              <option value="SFX">Sound Effect (SFX)</option>
              <option value="OUTRO">Outro Video/Graphic</option>
              <option value="FONT">Font File</option>
              <option value="BROLL">B-Roll Footage</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-neutral-400 mb-1">
              Filter Brand
            </label>
            <select
              name="brandId"
              defaultValue={selectedBrandId || ""}
              className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">All Brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {selectedBrandId && products.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-neutral-400 mb-1">
                Filter Product
              </label>
              <select
                name="productId"
                defaultValue={selectedProductId || ""}
                className="rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-end gap-2 mt-[18px]">
            <button
              type="submit"
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Filter Vault
            </button>
            <Link
              href="/assets"
              className="rounded border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200"
            >
              Reset
            </Link>
          </div>
        </form>
      </Card>

      {/* Asset Grid */}
      {assets.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-neutral-400">No assets match the selected criteria.</p>
          <p className="mt-1 text-xs text-neutral-500">
            Upload files into AIVA Vault or clear filters to view all assets.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => {
            const isReused = (asset.metadata as Record<string, unknown> | null)?.reused === true;
            const mime = asset.mimeType?.toLowerCase() || "";
            const isImage = mime.startsWith("image/");
            const isVideo = mime.startsWith("video/");
            const isAudio = mime.startsWith("audio/");

            return (
              <Card key={asset.id} className="p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-neutral-100 truncate">
                        {asset.title || asset.originalFilename || "Vault Asset"}
                      </p>
                      <p className="text-xs font-mono text-neutral-500 truncate">
                        {asset.originalFilename}
                      </p>
                    </div>
                    <Badge tone="info" className="text-[10px]">
                      {asset.vaultRole || asset.type}
                    </Badge>
                  </div>

                  {/* Browser Media Previews */}
                  <div className="mt-3 overflow-hidden rounded border border-neutral-800 bg-neutral-950 p-2">
                    {isImage && (
                      /* eslint-disable-next-line @next/next/no-img-element -- Raw <img> is required to render blob preview URLs from authenticated local API route /api/vault/[id]/content */
                      <img
                        src={`/api/vault/${asset.id}/content`}
                        alt={asset.title || "Asset"}
                        className="h-32 w-full object-contain"
                      />
                    )}
                    {isVideo && (
                      <video
                        controls
                        src={`/api/vault/${asset.id}/content`}
                        className="h-32 w-full object-cover rounded"
                      />
                    )}
                    {isAudio && (
                      <audio controls src={`/api/vault/${asset.id}/content`} className="w-full mt-2" />
                    )}
                    {!isImage && !isVideo && !isAudio && (
                      <div className="flex h-16 items-center justify-center text-xs text-neutral-500 font-mono">
                        {asset.vaultRole || "FILE"}
                      </div>
                    )}
                  </div>

                  {isReused && (
                    <div className="mt-2">
                      <Badge tone="success" className="text-[9px]">
                        ⚡ Deduplicated Content
                      </Badge>
                    </div>
                  )}

                  {asset.checksum && (
                    <div className="mt-2 font-mono text-[10px] text-neutral-600 truncate">
                      SHA: {asset.checksum.substring(0, 16)}...
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between text-[11px] text-neutral-500 border-t border-neutral-800/60 pt-3">
                  <span>{asset.mimeType || "unknown"}</span>
                  <span>
                    {asset.sizeBytes ? `${(asset.sizeBytes / 1024).toFixed(0)} KB` : ""}
                  </span>
                  <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
