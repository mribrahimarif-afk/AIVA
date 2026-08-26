import type { Product, ProductAlias, CreateProductInput, AddAliasInput } from "@/domain/product";
import { createProductSchema, addAliasSchema, normalizeAlias } from "@/domain/product";
import { slugify } from "@/domain/brand/brand.schema";
import { ValidationError, NotFoundError } from "@/domain/errors";
import type { ProductRepository } from "@/repositories/product.repository";
import type { BrandRepository } from "@/repositories/brand.repository";
import { logger } from "@/infrastructure/logging/logger";

export interface ProductService {
  createProduct(input: CreateProductInput): Promise<Product>;
  getProduct(id: string): Promise<Product>;
  listProductsByBrand(brandId: string): Promise<Product[]>;
  addAlias(input: AddAliasInput): Promise<ProductAlias>;
  removeAlias(aliasId: string): Promise<void>;
}

export function createProductService(
  productRepo: ProductRepository,
  brandRepo: BrandRepository
): ProductService {
  return {
    async createProduct(input) {
      const brand = await brandRepo.findById(input.brandId);
      if (!brand) {
        throw new NotFoundError(`Brand with id '${input.brandId}' not found`, {
          brandId: input.brandId,
        });
      }

      const generatedSlug = input.slug ? slugify(input.slug) : slugify(input.name);
      const parseResult = createProductSchema.safeParse({
        brandId: input.brandId,
        name: input.name,
        slug: generatedSlug,
        description: input.description,
      });

      if (!parseResult.success) {
        throw new ValidationError("Invalid product input", {
          issues: parseResult.error.issues,
        });
      }

      const existing = await productRepo.findByBrandAndSlug(input.brandId, generatedSlug);
      if (existing) {
        throw new ValidationError(
          `Product with slug '${generatedSlug}' already exists under brand '${brand.name}'`,
          { brandId: input.brandId, slug: generatedSlug }
        );
      }

      const product = await productRepo.create({
        brandId: parseResult.data.brandId,
        name: parseResult.data.name,
        slug: parseResult.data.slug!,
        description: parseResult.data.description,
      });

      logger.info({
        event: "product.created",
        productId: product.id,
        brandId: product.brandId,
        slug: product.slug,
        message: `Created product '${product.name}'`,
      });

      return product;
    },

    async getProduct(id) {
      const product = await productRepo.findById(id);
      if (!product) {
        throw new NotFoundError(`Product with id '${id}' not found`, { productId: id });
      }
      return product;
    },

    async listProductsByBrand(brandId) {
      const brand = await brandRepo.findById(brandId);
      if (!brand) {
        throw new NotFoundError(`Brand with id '${brandId}' not found`, { brandId });
      }
      return productRepo.findByBrandId(brandId);
    },

    async addAlias(input) {
      const parseResult = addAliasSchema.safeParse(input);
      if (!parseResult.success) {
        throw new ValidationError("Invalid alias input", {
          issues: parseResult.error.issues,
        });
      }

      const product = await productRepo.findById(input.productId);
      if (!product) {
        throw new NotFoundError(`Product with id '${input.productId}' not found`, {
          productId: input.productId,
        });
      }

      const rawAlias = parseResult.data.alias.trim();
      const normalized = normalizeAlias(rawAlias);

      if (!normalized) {
        throw new ValidationError("Alias cannot be blank after normalization", {
          rawAlias,
        });
      }

      const existingAlias = await productRepo.findAliasByProductAndNormalized(
        input.productId,
        normalized
      );
      if (existingAlias) {
        throw new ValidationError(`Alias '${rawAlias}' already exists for this product`, {
          productId: input.productId,
          alias: rawAlias,
          normalizedAlias: normalized,
        });
      }

      const alias = await productRepo.addAlias({
        productId: input.productId,
        alias: rawAlias,
        normalizedAlias: normalized,
      });

      logger.info({
        event: "product.alias_added",
        productId: input.productId,
        aliasId: alias.id,
        alias: alias.alias,
        normalizedAlias: alias.normalizedAlias,
        message: `Added alias '${alias.alias}' to product`,
      });

      return alias;
    },

    async removeAlias(aliasId) {
      await productRepo.removeAlias(aliasId);
      logger.info({
        event: "product.alias_removed",
        aliasId,
        message: `Removed alias '${aliasId}'`,
      });
    },
  };
}
