import { z } from "zod";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeAlias(alias: string): string {
  return alias
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const createProductSchema = z.object({
  brandId: z.string().trim().min(1, "Brand ID is required"),
  name: z.string().trim().min(1, "Product name is required").max(200),
  slug: z
    .string()
    .trim()
    .max(200)
    .regex(slugPattern, "Slug must be lowercase, alphanumeric, and hyphen-separated")
    .optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200).optional(),
  slug: z
    .string()
    .trim()
    .max(200)
    .regex(slugPattern, "Slug must be lowercase, alphanumeric, and hyphen-separated")
    .optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const addAliasSchema = z.object({
  productId: z.string().trim().min(1, "Product ID is required"),
  alias: z
    .string()
    .trim()
    .min(1, "Alias cannot be blank")
    .max(200, "Alias too long"),
});
