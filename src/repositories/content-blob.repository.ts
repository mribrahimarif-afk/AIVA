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
  const repo: ContentBlobRepository = {
    async create(input) {
      try {
        const row = await db.contentBlob.create({
          data: input,
        });
        return toContentBlob(row);
      } catch (err) {
        const isP2002 =
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: unknown }).code === "P2002";

        if (isP2002) {
          // Retry findByChecksum if concurrent request created the record
          for (let attempt = 0; attempt < 5; attempt++) {
            const existing = await repo.findByChecksum(input.checksum);
            if (existing) return existing;
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        throw err;
      }
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

  return repo;
}
