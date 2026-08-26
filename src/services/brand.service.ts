import type { Brand, CreateBrandInput } from "@/domain/brand";
import { createBrandSchema, slugify } from "@/domain/brand";
import { ValidationError, NotFoundError } from "@/domain/errors";
import type { BrandRepository } from "@/repositories/brand.repository";
import { logger } from "@/infrastructure/logging/logger";

export interface BrandService {
  createBrand(input: CreateBrandInput): Promise<Brand>;
  getBrand(id: string): Promise<Brand>;
  getBrandBySlug(slug: string): Promise<Brand>;
  listBrands(): Promise<Brand[]>;
}

export function createBrandService(brandRepo: BrandRepository): BrandService {
  return {
    async createBrand(input) {
      const generatedSlug = input.slug ? slugify(input.slug) : slugify(input.name);
      const parseResult = createBrandSchema.safeParse({
        name: input.name,
        slug: generatedSlug,
      });

      if (!parseResult.success) {
        throw new ValidationError("Invalid brand input", {
          issues: parseResult.error.issues,
        });
      }

      const existing = await brandRepo.findBySlug(generatedSlug);
      if (existing) {
        throw new ValidationError(`Brand with slug '${generatedSlug}' already exists`, {
          slug: generatedSlug,
        });
      }

      const brand = await brandRepo.create({
        name: parseResult.data.name,
        slug: generatedSlug,
      });

      logger.info({
        event: "brand.created",
        brandId: brand.id,
        slug: brand.slug,
        message: `Created brand '${brand.name}'`,
      });

      return brand;
    },

    async getBrand(id) {
      const brand = await brandRepo.findById(id);
      if (!brand) {
        throw new NotFoundError(`Brand with id '${id}' not found`, { brandId: id });
      }
      return brand;
    },

    async getBrandBySlug(slug) {
      const brand = await brandRepo.findBySlug(slug);
      if (!brand) {
        throw new NotFoundError(`Brand with slug '${slug}' not found`, { slug });
      }
      return brand;
    },

    async listBrands() {
      return brandRepo.findAll();
    },
  };
}
