"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { VaultRole } from "@/domain/asset";
import { ROLE_FILE_RULES } from "@/domain/asset";

export function UploadButtonModal({
  defaultRole,
  brandId,
  productId,
  buttonLabel = "Upload Asset",
}: {
  defaultRole?: VaultRole;
  brandId?: string;
  productId?: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [role, setRole] = useState<VaultRole>(defaultRole || "BRAND_LOGO");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const rules = ROLE_FILE_RULES[role];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!title) {
        setTitle(selectedFile.name);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("vaultRole", role);
      if (brandId) formData.append("brandId", brandId);
      if (productId) formData.append("productId", productId);
      if (title.trim()) formData.append("title", title.trim());

      const res = await fetch("/api/vault/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || "Upload failed");
      }

      if (data.isDuplicate) {
        setSuccessMessage(`Upload successful! Duplicate file detected — reused canonical storage blob.`);
      } else {
        setSuccessMessage(`Upload successful! New asset stored in vault.`);
      }

      setFile(null);
      setTitle("");
      setTimeout(() => {
        setIsOpen(false);
        setSuccessMessage(null);
        router.refresh();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>
        + {buttonLabel}
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-lg bg-neutral-900 border-neutral-800 p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-neutral-100 mb-1">Upload Asset to Vault</h2>
            <p className="text-xs text-neutral-400 mb-4">
              Assets are stored securely in AIVA Vault with SHA-256 deduplication.
            </p>

            {error && (
              <div className="mb-4 rounded border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-400">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="mb-4 rounded border border-emerald-900/50 bg-emerald-950/40 p-3 text-xs text-emerald-400">
                {successMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Vault Role *
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as VaultRole)}
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="BRAND_LOGO">Brand Logo</option>
                  <option value="PRODUCT_VIDEO">Product Video</option>
                  <option value="MUSIC">Music Track</option>
                  <option value="SFX">Sound Effect (SFX)</option>
                  <option value="OUTRO">Outro Video/Graphic</option>
                  <option value="FONT">Font File</option>
                  <option value="BROLL">B-Roll Footage</option>
                </select>
                <p className="mt-1 text-[11px] text-neutral-500">
                  Allowed extensions: {rules?.allowedExtensions.join(", ")}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Select File *
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept={rules?.allowedExtensions.join(",")}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center rounded border border-dashed border-neutral-700 bg-neutral-950/60 p-6 transition-colors hover:border-indigo-500"
                >
                  {file ? (
                    <div className="text-center">
                      <p className="font-medium text-neutral-200">{file.name}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.type || "unknown mime"}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm text-neutral-300">Click to select file for upload</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        Supported: {rules?.allowedExtensions.join(", ")}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Display Title (Optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Custom asset title"
                  className="w-full rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="mt-4 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || !file}>
                  {isSubmitting ? "Uploading & Hashing..." : "Upload File"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
