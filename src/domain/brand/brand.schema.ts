import { z } from "zod";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createBrandSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(200)
    .regex(slugPattern, "Slug must be lowercase, alphanumeric, and hyphen-separated"),
});

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
