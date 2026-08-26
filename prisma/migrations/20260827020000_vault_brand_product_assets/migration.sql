-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "product_aliases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_aliases_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "content_blobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "originalFilename" TEXT,
    "type" TEXT NOT NULL,
    "vaultRole" TEXT,
    "source" TEXT NOT NULL,
    "localPath" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT,
    "brandId" TEXT,
    "productId" TEXT,
    "blobId" TEXT,
    CONSTRAINT "assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "assets_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "assets_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "assets_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "content_blobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_assets" ("id", "type", "source", "localPath", "metadata", "createdAt", "projectId") SELECT "id", "type", "source", "localPath", "metadata", "createdAt", "projectId" FROM "assets";
DROP TABLE "assets";
ALTER TABLE "new_assets" RENAME TO "assets";
CREATE INDEX "assets_projectId_idx" ON "assets"("projectId");
CREATE INDEX "assets_brandId_idx" ON "assets"("brandId");
CREATE INDEX "assets_productId_idx" ON "assets"("productId");
CREATE INDEX "assets_blobId_idx" ON "assets"("blobId");
CREATE INDEX "assets_vaultRole_idx" ON "assets"("vaultRole");
CREATE INDEX "assets_checksum_idx" ON "assets"("checksum");
CREATE INDEX "assets_type_idx" ON "assets"("type");
CREATE INDEX "assets_source_idx" ON "assets"("source");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "products_brandId_idx" ON "products"("brandId");
CREATE INDEX "products_name_idx" ON "products"("name");
CREATE UNIQUE INDEX "products_brandId_slug_key" ON "products"("brandId", "slug");

-- CreateIndex
CREATE INDEX "product_aliases_productId_idx" ON "product_aliases"("productId");
CREATE INDEX "product_aliases_normalizedAlias_idx" ON "product_aliases"("normalizedAlias");
CREATE UNIQUE INDEX "product_aliases_productId_normalizedAlias_key" ON "product_aliases"("productId", "normalizedAlias");

-- CreateIndex
CREATE UNIQUE INDEX "content_blobs_checksum_key" ON "content_blobs"("checksum");
CREATE INDEX "content_blobs_checksum_idx" ON "content_blobs"("checksum");
