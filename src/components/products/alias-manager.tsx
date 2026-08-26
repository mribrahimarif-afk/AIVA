"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { ProductAlias } from "@/domain/product";

export function AliasManager({
  productId,
  aliases = [],
}: {
  productId: string;
  aliases?: ProductAlias[];
}) {
  const router = useRouter();
  const [newAlias, setNewAlias] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlias.trim()) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/products/${productId}/aliases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: newAlias.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to add alias");
      }

      setNewAlias("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveAlias = async (aliasId: string) => {
    try {
      const res = await fetch(`/api/products/${productId}/aliases/${aliasId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Failed to remove alias");
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {aliases.length === 0 ? (
          <span className="text-xs text-neutral-500">No aliases added yet.</span>
        ) : (
          aliases.map((alias) => (
            <Badge
              key={alias.id}
              tone="neutral"
              className="group flex items-center gap-1 text-xs py-1 px-2.5"
            >
              <span>{alias.alias}</span>
              <button
                onClick={() => handleRemoveAlias(alias.id)}
                className="ml-1 text-neutral-400 hover:text-red-400 text-xs"
                title="Remove alias"
              >
                ×
              </button>
            </Badge>
          ))
        )}
      </div>

      <form onSubmit={handleAddAlias} className="flex gap-2 max-w-sm">
        <Input
          value={newAlias}
          onChange={(e) => setNewAlias(e.target.value)}
          placeholder="Add alias (e.g. MEA, Majoon Adam)"
          className="text-xs"
        />
        <Button type="submit" disabled={isSubmitting || !newAlias.trim()} className="text-xs">
          + Add
        </Button>
      </form>
    </div>
  );
}
