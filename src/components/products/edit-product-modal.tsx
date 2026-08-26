"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { Product } from "@/domain/product";

export function EditProductModal({ product }: { product: Product }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState(product.name);
  const [slug, setSlug] = useState(product.slug);
  const [description, setDescription] = useState(product.description || "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to update product");
      }

      setIsOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setIsOpen(true)} className="text-xs">
        Edit Product Details
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-md p-6 bg-neutral-900 border-neutral-800">
            <h2 className="text-lg font-semibold text-neutral-50">Edit Product</h2>
            <p className="mt-1 text-xs text-neutral-400">
              Update name, slug, or description for {product.name}.
            </p>

            {error && (
              <div className="mt-4 rounded border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-400">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-300">Product Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ultraboost 5"
                  required
                  className="mt-1 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300">Slug</label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. ultraboost-5"
                  required
                  className="mt-1 text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-300">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Product description and details..."
                  rows={3}
                  className="mt-1 w-full rounded border border-neutral-800 bg-neutral-950 p-2 text-xs text-neutral-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsOpen(false)}
                  disabled={isSubmitting}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting} className="text-xs">
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
