import type { PrismaClient } from "@prisma/client";
import type { Brand } from "@/domain/brand";
import { toBrand } from "./mappers";

export interface CreateBrandRecord {
  name: string;
  slug: string;
}

export interface BrandRepository {
  create(input: CreateBrandRecord): Promise<Brand>;
  findAll(): Promise<Brand[]>;
  findById(id: string): Promise<Brand | null>;
  findBySlug(slug: string): Promise<Brand | null>;
  count(): Promise<number>;
}

export function createBrandRepository(db: PrismaClient): BrandRepository {
  return {
    async create(input) {
      const row = await db.brand.create({ data: input });
      return toBrand(row);
    },

    async findAll() {
      const rows = await db.brand.findMany({
        orderBy: { createdAt: "desc" },
        include: { products: true },
      });
      return rows.map(toBrand);
    },

    async findById(id) {
      const row = await db.brand.findUnique({
        where: { id },
        include: { products: true },
      });
      return row ? toBrand(row) : null;
    },

    async findBySlug(slug) {
      const row = await db.brand.findUnique({
        where: { slug },
        include: { products: true },
      });
      return row ? toBrand(row) : null;
    },

    async count() {
      return db.brand.count();
    },
  };
}
