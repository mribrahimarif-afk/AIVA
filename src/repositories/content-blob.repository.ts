import type { PrismaClient } from "@prisma/client";
import type { ContentBlob } from "@/domain/asset";
import { toContentBlob } from "./mappers";

export interface CreateContentBlobRecord {
  checksum: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
}

export interface ContentBlobRepository {
  create(input: CreateContentBlobRecord): Promise<ContentBlob>;
  findByChecksum(checksum: string): Promise<ContentBlob | null>;
  findById(id: string): Promise<ContentBlob | null>;
}

export function createContentBlobRepository(db: PrismaClient): ContentBlobRepository {
  return {
    async create(input) {
      const row = await db.contentBlob.create({
        data: input,
      });
      return toContentBlob(row);
    },

    async findByChecksum(checksum) {
      const row = await db.contentBlob.findUnique({
        where: { checksum },
      });
      return row ? toContentBlob(row) : null;
    },

    async findById(id) {
      const row = await db.contentBlob.findUnique({
        where: { id },
      });
      return row ? toContentBlob(row) : null;
    },
  };
}
