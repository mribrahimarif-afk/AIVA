import type { Asset, VaultRole } from "@/domain/asset";
import { ROLE_FILE_RULES, validateRoleFile, vaultRoleSchema } from "@/domain/asset";
import { ValidationError, NotFoundError, StorageError } from "@/domain/errors";
import type { AssetRepository, VaultAssetFilter } from "@/repositories/asset.repository";
import type { ContentBlobRepository } from "@/repositories/content-blob.repository";
import type { BrandRepository } from "@/repositories/brand.repository";
import type { ProductRepository } from "@/repositories/product.repository";
import { storageService, type StagedUploadResult } from "@/storage/storage.service";
import { logger } from "@/infrastructure/logging/logger";

export interface UploadVaultAssetInput {
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType: string;
  vaultRole: VaultRole;
  brandId?: string | null;
  productId?: string | null;
  title?: string | null;
}

export interface UploadVaultAssetResult {
  asset: Asset;
  isDuplicate: boolean;
}

export interface VaultService {
  uploadAsset(input: UploadVaultAssetInput): Promise<UploadVaultAssetResult>;
  getAsset(id: string): Promise<Asset>;
  listAssets(filter?: VaultAssetFilter): Promise<Asset[]>;
}

export function createVaultService(
  assetRepo: AssetRepository,
  blobRepo: ContentBlobRepository,
  brandRepo: BrandRepository,
  productRepo: ProductRepository
): VaultService {
  return {
    async uploadAsset(input) {
      const roleResult = vaultRoleSchema.safeParse(input.vaultRole);
      if (!roleResult.success) {
        throw new ValidationError(`Invalid vault role '${input.vaultRole}'`, {
          role: input.vaultRole,
        });
      }
      const role = roleResult.data;

      // Ownership invariant enforcement
      let resolvedBrandId = input.brandId ?? null;
      const resolvedProductId = input.productId ?? null;

      if (role === "BRAND_LOGO") {
        if (!resolvedBrandId) {
          throw new ValidationError("brandId is required for BRAND_LOGO vault role", { role });
        }
        if (resolvedProductId) {
          throw new ValidationError("productId is not permitted for BRAND_LOGO vault role", {
            role,
            productId: resolvedProductId,
          });
        }
      }

      if (role === "PRODUCT_VIDEO") {
        if (!resolvedProductId) {
          throw new ValidationError("productId is required for PRODUCT_VIDEO vault role", { role });
        }
      }

      if (resolvedProductId) {
        const product = await productRepo.findById(resolvedProductId);
        if (!product) {
          throw new NotFoundError(`Product with id '${resolvedProductId}' not found`, {
            productId: resolvedProductId,
          });
        }
        if (resolvedBrandId && product.brandId !== resolvedBrandId) {
          throw new ValidationError(
            `Product '${product.id}' does not belong to brand '${resolvedBrandId}'`,
            { productId: product.id, brandId: resolvedBrandId }
          );
        }
        resolvedBrandId = product.brandId;
      } else if (resolvedBrandId) {
        const brand = await brandRepo.findById(resolvedBrandId);
        if (!brand) {
          throw new NotFoundError(`Brand with id '${resolvedBrandId}' not found`, {
            brandId: resolvedBrandId,
          });
        }
      }

      logger.info({
        event: "vault.upload_started",
        originalFilename: input.originalFilename,
        role,
        brandId: resolvedBrandId,
        productId: resolvedProductId,
        message: `Starting upload for '${input.originalFilename}' as ${role}`,
      });

      let stagedInfo: StagedUploadResult;
      try {
        stagedInfo = await storageService.stageFile(input.fileBuffer, input.originalFilename);
      } catch (stageErr) {
        logger.error({
          event: "vault.upload_failed",
          originalFilename: input.originalFilename,
          error: stageErr,
          message: "Failed to stage temporary upload file",
        });
        throw stageErr;
      }

      const { tempPath, sizeBytes, checksum, extension, leadingBuffer } = stagedInfo;

      let validationResult: { detectedExt: string | null; detectedMime: string | null };
      try {
        validationResult = validateRoleFile(input.originalFilename, input.mimeType, role, leadingBuffer);
      } catch (validationErr) {
        await storageService.removeTempFile(tempPath);
        throw new ValidationError(
          validationErr instanceof Error ? validationErr.message : String(validationErr),
          { originalFilename: input.originalFilename, mimeType: input.mimeType, role }
        );
      }

      const canonicalExtension = validationResult.detectedExt
        ? `.${validationResult.detectedExt}`
        : extension;

      let isNewCanonicalFileCreated = false;
      let createdCanonicalAbsPath: string | null = null;

      try {
        const existingBlob = await blobRepo.findByChecksum(checksum);
        const rules = ROLE_FILE_RULES[role];
        const defaultAssetType = rules.defaultAssetType;

        if (existingBlob) {
          await storageService.removeTempFile(tempPath);

          const asset = await assetRepo.create({
            title: input.title || input.originalFilename,
            originalFilename: input.originalFilename,
            type: defaultAssetType,
            vaultRole: role,
            source: "LOCAL_UPLOAD",
            localPath: existingBlob.storagePath,
            mimeType: validationResult.detectedMime || input.mimeType || existingBlob.mimeType,
            sizeBytes,
            checksum,
            metadata: {
              reused: true,
              deduplicated: true,
            },
            brandId: resolvedBrandId,
            productId: resolvedProductId,
            blobId: existingBlob.id,
          });

          logger.info({
            event: "vault.duplicate_reused",
            assetId: asset.id,
            blobId: existingBlob.id,
            checksum,
            sizeBytes,
            role,
            message: `Reused existing content blob for '${input.originalFilename}'`,
          });

          return { asset, isDuplicate: true };
        }

        const finalized = await storageService.finalizeBlob(tempPath, checksum, canonicalExtension);
        isNewCanonicalFileCreated = finalized.isNewCanonicalFile;
        createdCanonicalAbsPath = finalized.canonicalAbsolutePath;

        let blob = await blobRepo.findByChecksum(checksum);
        if (!blob) {
          try {
            blob = await blobRepo.create({
              checksum,
              storagePath: finalized.storageRelativePath,
              sizeBytes,
              mimeType: validationResult.detectedMime || input.mimeType || "application/octet-stream",
            });
          } catch (dbErr) {
            blob = await blobRepo.findByChecksum(checksum);
            if (!blob) {
              throw new StorageError("Failed to persist content blob record in database", {
                checksum,
                storagePath: finalized.storageRelativePath,
                cause: dbErr instanceof Error ? dbErr.message : String(dbErr),
              });
            }
          }
        }

        const asset = await assetRepo.create({
          title: input.title || input.originalFilename,
          originalFilename: input.originalFilename,
          type: defaultAssetType,
          vaultRole: role,
          source: "LOCAL_UPLOAD",
          localPath: blob.storagePath,
          mimeType: validationResult.detectedMime || input.mimeType || blob.mimeType,
          sizeBytes,
          checksum,
          metadata: {
            reused: false,
            deduplicated: false,
          },
          brandId: resolvedBrandId,
          productId: resolvedProductId,
          blobId: blob.id,
        });

        logger.info({
          event: "vault.asset_stored",
          assetId: asset.id,
          blobId: blob.id,
          checksum,
          sizeBytes,
          role,
          message: `Stored new canonical asset '${input.originalFilename}'`,
        });

        return { asset, isDuplicate: false };
      } catch (err) {
        await storageService.removeTempFile(tempPath).catch(() => {});

        // Safe compensation if THIS upload created an otherwise unreferenced new canonical file
        if (isNewCanonicalFileCreated && createdCanonicalAbsPath) {
          const existingBlobCount = await blobRepo.findByChecksum(checksum);
          if (!existingBlobCount) {
            await storageService.compensateCanonicalBlob(createdCanonicalAbsPath).catch(() => {});
          }
        }

        logger.error({
          event: "vault.upload_failed",
          originalFilename: input.originalFilename,
          error: err,
          message: "Failed during vault asset processing",
        });
        throw err;
      }
    },

    async getAsset(id) {
      const asset = await assetRepo.findById(id);
      if (!asset) {
        throw new NotFoundError(`Vault asset with id '${id}' not found`, { assetId: id });
      }
      return asset;
    },

    async listAssets(filter) {
      return assetRepo.filterVault(filter);
    },
  };
}
