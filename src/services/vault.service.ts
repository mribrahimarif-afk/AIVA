import type { Readable } from "node:stream";
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

export interface UploadVaultAssetStreamInput {
  fileStream: ReadableStream<Uint8Array> | Readable;
  originalFilename: string;
  mimeType: string;
  vaultRole: VaultRole;
  brandId?: string | null;
  productId?: string | null;
  title?: string | null;
}

export interface UploadVaultAssetStagedInput {
  stagedInfo: StagedUploadResult;
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
  uploadStream(input: UploadVaultAssetStreamInput): Promise<UploadVaultAssetResult>;
  uploadStaged(input: UploadVaultAssetStagedInput): Promise<UploadVaultAssetResult>;
  getAsset(id: string): Promise<Asset>;
  listAssets(filter?: VaultAssetFilter): Promise<Asset[]>;
}

export function createVaultService(
  assetRepo: AssetRepository,
  blobRepo: ContentBlobRepository,
  brandRepo: BrandRepository,
  productRepo: ProductRepository
): VaultService {
  async function resolveAndValidateOwnership(
    roleInput: unknown,
    brandIdInput?: string | null,
    productIdInput?: string | null
  ): Promise<{ role: VaultRole; resolvedBrandId: string | null; resolvedProductId: string | null }> {
    const roleResult = vaultRoleSchema.safeParse(roleInput);
    if (!roleResult.success) {
      throw new ValidationError(`Invalid vault role '${roleInput}'`, {
        role: roleInput,
      });
    }
    const role = roleResult.data;

    let resolvedBrandId = brandIdInput ?? null;
    const resolvedProductId = productIdInput ?? null;

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

    return { role, resolvedBrandId, resolvedProductId };
  }

  async function processStagedUpload(
    stagedInfo: StagedUploadResult,
    originalFilename: string,
    mimeType: string,
    role: VaultRole,
    resolvedBrandId: string | null,
    resolvedProductId: string | null,
    title?: string | null
  ): Promise<UploadVaultAssetResult> {
    const { tempPath, sizeBytes, checksum, leadingBuffer } = stagedInfo;

    let validationResult: { detectedExt: string; detectedMime: string };
    try {
      validationResult = validateRoleFile(originalFilename, mimeType, role, leadingBuffer);
    } catch (validationErr) {
      let cleanupFailed = false;
      let cleanupErrMessage = "";
      try {
        await storageService.removeTempFile(tempPath);
      } catch (rmErr) {
        cleanupFailed = true;
        cleanupErrMessage = rmErr instanceof Error ? rmErr.message : String(rmErr);
      }

      if (cleanupFailed) {
        throw new StorageError(
          `File validation failed for '${originalFilename}', and temporary file cleanup also failed; file is orphaned at '${tempPath}'`,
          {
            tempPath,
            partialUploadOrphaned: true,
            validationCause: validationErr instanceof Error ? validationErr.message : String(validationErr),
            cleanupCause: cleanupErrMessage,
          }
        );
      }

      throw new ValidationError(
        validationErr instanceof Error ? validationErr.message : String(validationErr),
        { originalFilename, mimeType, role }
      );
    }

    const rules = ROLE_FILE_RULES[role];
    const defaultAssetType = rules.defaultAssetType;
    const canonicalExtension = `.${validationResult.detectedExt}`;

    // Fast-path: Check if ContentBlob already exists in DB
    const preExistingBlob = await blobRepo.findByChecksum(checksum);
    if (preExistingBlob) {
      await storageService.removeTempFile(tempPath);

      const asset = await assetRepo.create({
        title: title || originalFilename,
        originalFilename,
        type: defaultAssetType,
        vaultRole: role,
        source: "LOCAL_UPLOAD",
        localPath: preExistingBlob.storagePath,
        mimeType: validationResult.detectedMime || mimeType || preExistingBlob.mimeType,
        sizeBytes,
        checksum,
        metadata: {
          reused: true,
          deduplicated: true,
        },
        brandId: resolvedBrandId,
        productId: resolvedProductId,
        blobId: preExistingBlob.id,
      });

      logger.info({
        event: "vault.duplicate_reused",
        assetId: asset.id,
        blobId: preExistingBlob.id,
        checksum,
        sizeBytes,
        role,
        message: `Reused existing content blob for '${originalFilename}'`,
      });

      return { asset, isDuplicate: true };
    }

    let isNewCanonicalFileCreated = false;
    let createdCanonicalAbsPath: string | null = null;

    try {
      const finalized = await storageService.finalizeBlob(tempPath, checksum, canonicalExtension);
      isNewCanonicalFileCreated = finalized.isNewCanonicalFile;
      createdCanonicalAbsPath = finalized.canonicalAbsolutePath;

      let blob = await blobRepo.findByChecksum(checksum);
      if (!blob) {
        blob = await blobRepo.create({
          checksum,
          storagePath: finalized.storageRelativePath,
          sizeBytes,
          mimeType: validationResult.detectedMime || mimeType || "application/octet-stream",
        });
      }

      const isDuplicate = !isNewCanonicalFileCreated;

      const asset = await assetRepo.create({
        title: title || originalFilename,
        originalFilename,
        type: defaultAssetType,
        vaultRole: role,
        source: "LOCAL_UPLOAD",
        localPath: blob.storagePath,
        mimeType: validationResult.detectedMime || mimeType || blob.mimeType,
        sizeBytes,
        checksum,
        metadata: {
          reused: isDuplicate,
          deduplicated: isDuplicate,
        },
        brandId: resolvedBrandId,
        productId: resolvedProductId,
        blobId: blob.id,
      });

      logger.info({
        event: isNewCanonicalFileCreated ? "vault.asset_stored" : "vault.duplicate_reused",
        assetId: asset.id,
        blobId: blob.id,
        checksum,
        sizeBytes,
        role,
        message: isNewCanonicalFileCreated
          ? `Stored new canonical asset '${originalFilename}'`
          : `Reused existing content blob for '${originalFilename}'`,
      });

      return { asset, isDuplicate };
    } catch (err) {
      // Safe compensation if THIS request created a new canonical file and no ContentBlob references it
      if (isNewCanonicalFileCreated && createdCanonicalAbsPath) {
        const existingBlob = await blobRepo.findByChecksum(checksum);
        if (!existingBlob) {
          try {
            await storageService.compensateCanonicalBlob(createdCanonicalAbsPath);
          } catch (compErr) {
            logger.error({
              event: "vault.compensation_failed",
              canonicalAbsolutePath: createdCanonicalAbsPath,
              error: compErr,
              message: "Failed to compensate canonical file after asset creation failure",
            });
            throw new StorageError(
              `Asset processing failed and canonical file compensation also failed; file is orphaned at '${createdCanonicalAbsPath}'`,
              {
                canonicalAbsolutePath: createdCanonicalAbsPath,
                canonicalOrphaned: true,
                primaryCause: err instanceof Error ? err.message : String(err),
                compensationCause: compErr instanceof Error ? compErr.message : String(compErr),
              }
            );
          }
        }
      }

      logger.error({
        event: "vault.upload_failed",
        originalFilename,
        error: err,
        message: "Failed during vault asset processing",
      });
      throw err;
    }
  }

  return {
    async uploadAsset(input) {
      const { role, resolvedBrandId, resolvedProductId } = await resolveAndValidateOwnership(
        input.vaultRole,
        input.brandId,
        input.productId
      );

      logger.info({
        event: "vault.upload_started",
        originalFilename: input.originalFilename,
        role,
        brandId: resolvedBrandId,
        productId: resolvedProductId,
        message: `Starting upload for '${input.originalFilename}' as ${role}`,
      });

      const stagedInfo = await storageService.stageFile(input.fileBuffer, input.originalFilename);
      return processStagedUpload(
        stagedInfo,
        input.originalFilename,
        input.mimeType,
        role,
        resolvedBrandId,
        resolvedProductId,
        input.title
      );
    },

    async uploadStream(input) {
      const { role, resolvedBrandId, resolvedProductId } = await resolveAndValidateOwnership(
        input.vaultRole,
        input.brandId,
        input.productId
      );

      logger.info({
        event: "vault.stream_upload_started",
        originalFilename: input.originalFilename,
        role,
        brandId: resolvedBrandId,
        productId: resolvedProductId,
        message: `Starting stream upload for '${input.originalFilename}' as ${role}`,
      });

      const stagedInfo = await storageService.stageStream(input.fileStream, input.originalFilename);
      return processStagedUpload(
        stagedInfo,
        input.originalFilename,
        input.mimeType,
        role,
        resolvedBrandId,
        resolvedProductId,
        input.title
      );
    },

    async uploadStaged(input) {
      const { role, resolvedBrandId, resolvedProductId } = await resolveAndValidateOwnership(
        input.vaultRole,
        input.brandId,
        input.productId
      );

      return processStagedUpload(
        input.stagedInfo,
        input.originalFilename,
        input.mimeType,
        role,
        resolvedBrandId,
        resolvedProductId,
        input.title
      );
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
