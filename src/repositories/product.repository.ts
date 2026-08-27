import type { PrismaClient } from "@prisma/client";
import type { Product, ProductAlias } from "@/domain/product";
import { toProduct, toProductAlias } from "./mappers";

export interface CreateProductRecord {
  brandId: string;
  name: string;
  slug: string;
  description?: string | null;
}

export interface UpdateProductRecord {
  name?: string;
  slug?: string;
  description?: string | null;
}

export interface CreateProductAliasRecord {
  productId: string;
  alias: string;
  normalizedAlias: string;
}

export interface ProductRepository {
  create(input: CreateProductRecord): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  findByBrandAndSlug(brandId: string, slug: string): Promise<Product | null>;
  findByBrandId(brandId: string): Promise<Product[]>;
  update(id: string, input: UpdateProductRecord): Promise<Product>;
  addAlias(input: CreateProductAliasRecord): Promise<ProductAlias>;
  removeAlias(aliasId: string): Promise<void>;
  findAliasByProductAndNormalized(productId: string, normalizedAlias: string): Promise<ProductAlias | null>;
  countByBrandId(brandId: string): Promise<number>;
}

export function createProductRepository(db: PrismaClient): ProductRepository {
  return {
    async create(input) {
      const row = await db.product.create({
        data: {
          brandId: input.brandId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
        },
        include: { aliases: true },
      });
      return toProduct(row);
    },

    async findById(id) {
      const row = await db.product.findUnique({
        where: { id },
        include: { aliases: true },
      });
      return row ? toProduct(row) : null;
    },

    async findByBrandAndSlug(brandId, slug) {
      const row = await db.product.findUnique({
        where: { brandId_slug: { brandId, slug } },
        include: { aliases: true },
      });
      return row ? toProduct(row) : null;
    },

    async findByBrandId(brandId) {
      const rows = await db.product.findMany({
        where: { brandId },
        orderBy: { name: "asc" },
        include: { aliases: true },
      });
      return rows.map(toProduct);
    },

    async update(id, input) {
      const row = await db.product.update({
        where: { id },
        data: input,
        include: { aliases: true },
      });
      return toProduct(row);
    },

    async addAlias(input) {
      const row = await db.productAlias.create({
        data: {
          productId: input.productId,
          alias: input.alias,
          normalizedAlias: input.normalizedAlias,
        },
      });
      return toProductAlias(row);
    },

    async removeAlias(aliasId) {
      await db.productAlias.delete({ where: { id: aliasId } });
    },

    async findAliasByProductAndNormalized(productId, normalizedAlias) {
      const row = await db.productAlias.findUnique({
        where: { productId_normalizedAlias: { productId, normalizedAlias } },
      });
      return row ? toProductAlias(row) : null;
    },

    async countByBrandId(brandId) {
      return db.product.count({ where: { brandId } });
    },
  };
}
