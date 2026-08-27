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

/**
 * Process-Local Per-Checksum Async Mutex.
 *
 * Provides in-process serialization per SHA-256 binary content checksum.
 * Ensures concurrent upload requests targeting identical binary content execute sequentially through
 * the complete critical lifecycle: DB check -> canonical file creation -> ContentBlob DB record creation -> Asset linking -> compensation.
 *
 * NOTE: This implementation is process-local for single-machine local deployment (TASK-002 scope).
 * Multi-process or distributed node deployments require a distributed lock manager (e.g. Redis Redlock),
 * which is outside the scope of TASK-002.
 */
export class ChecksumMutex {
  private locks = new Map<string, Promise<void>>();

  async runExclusive<T>(checksum: string, task: () => Promise<T>): Promise<T> {
    while (this.locks.has(checksum)) {
      await this.locks.get(checksum);
    }

    let resolveNext!: () => void;
    const lockPromise = new Promise<void>((res) => {
      resolveNext = res;
    });
    this.locks.set(checksum, lockPromise);

    try {
      return await task();
    } finally {
      this.locks.delete(checksum);
      resolveNext();
    }
  }
}

export const checksumMutex = new ChecksumMutex();

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
    vaultRoleInput: VaultRole,
    brandIdInput?: string | null,
    productIdInput?: string | null,
    title?: string | null
  ): Promise<UploadVaultAssetResult> {
    const { tempPath, sizeBytes, checksum, leadingBuffer } = stagedInfo;

    try {
      // Critical Lifecycle under Per-Checksum Process-Local Mutex
      return await checksumMutex.runExclusive(checksum, async () => {
        const { role, resolvedBrandId, resolvedProductId } = await resolveAndValidateOwnership(
          vaultRoleInput,
          brandIdInput,
          productIdInput
        );

        let validationResult: { detectedExt: string; detectedMime: string };
        try {
          validationResult = validateRoleFile(originalFilename, mimeType, role, leadingBuffer);
        } catch (validationErr) {
          throw new ValidationError(
            validationErr instanceof Error ? validationErr.message : String(validationErr),
            { originalFilename, mimeType, role }
          );
        }

        const rules = ROLE_FILE_RULES[role];
        const defaultAssetType = rules.defaultAssetType;
        const canonicalExtension = `.${validationResult.detectedExt}`;

        // 1. Check if ContentBlob already exists in DB
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

        let createdByThisUpload = false;
        let createdCanonicalAbsPath: string | null = null;

        try {
          // Phase A + Phase B: finalize the blob (2-phase state machine)
          const finalized = await storageService.finalizeBlob(tempPath, checksum, canonicalExtension);
          createdByThisUpload = finalized.createdByThisUpload;
          createdCanonicalAbsPath = finalized.canonicalAbsolutePath;

          // ---------------------------------------------------------------
          // CRITICAL: If Phase-B temp cleanup failed inside finalizeBlob,
          // retry cleanup HERE — BEFORE creating any DB records.
          // This ensures we never commit Asset + return failure.
          // ---------------------------------------------------------------
          if (finalized.tempCleanupFailed) {
            let retryCleanupFailed = false;
            let retryCleanupErrorMessage = "";
            try {
              await storageService.removeTempFile(tempPath);
            } catch (retryErr) {
              retryCleanupFailed = true;
              retryCleanupErrorMessage =
                retryErr instanceof Error ? retryErr.message : String(retryErr);
            }

            if (retryCleanupFailed) {
              // Cleanup still failed — do NOT create DB records.
              // Compensate canonical only if we created it and no ContentBlob exists yet.
              let canonicalOrphaned = false;
              if (createdByThisUpload && createdCanonicalAbsPath) {
                const existingBlob = await blobRepo.findByChecksum(checksum);
                if (!existingBlob) {
                  try {
                    await storageService.compensateCanonicalBlob(createdCanonicalAbsPath);
                    canonicalOrphaned = false;
                  } catch (compErr) {
                    canonicalOrphaned = true;
                    logger.error({
                      event: "vault.compensation_failed",
                      canonicalAbsolutePath: createdCanonicalAbsPath,
                      error: compErr,
                      message:
                        "Failed to compensate canonical file after temp cleanup failure; canonical is orphaned",
                    });
                  }
                }
                // pre-existing canonical (createdByThisUpload=false) is never removed
              }

              throw new StorageError(
                canonicalOrphaned
                  ? `Upload failed: temp file cleanup failed and canonical file compensation also failed; both files are orphaned`
                  : `Upload failed: temp file cleanup failed; temp file is orphaned at ${tempPath}`,
                {
                  partialUploadOrphaned: true,
                  tempPath,
                  canonicalAbsolutePath: createdCanonicalAbsPath,
                  canonicalOrphaned,
                  retryCleanupCause: retryCleanupErrorMessage,
                }
              );
            }
            // Retry succeeded — temp is now clean; continue to persist DB records normally.
          }

          // DB record creation — only reached when temp is confirmed clean
          let blob = await blobRepo.findByChecksum(checksum);
          if (!blob) {
            blob = await blobRepo.create({
              checksum,
              storagePath: finalized.storageRelativePath,
              sizeBytes,
              mimeType: validationResult.detectedMime || mimeType || "application/octet-stream",
            });
          }

          const isDuplicate = !createdByThisUpload;

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
            event: createdByThisUpload ? "vault.asset_stored" : "vault.duplicate_reused",
            assetId: asset.id,
            blobId: blob.id,
            checksum,
            sizeBytes,
            role,
            message: createdByThisUpload
              ? `Stored new canonical asset '${originalFilename}'`
              : `Reused existing content blob for '${originalFilename}'`,
          });

          return { asset, isDuplicate };
        } catch (err) {
          // Safe Reference-Safe Compensation under Mutex
          if (createdByThisUpload && createdCanonicalAbsPath) {
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
      });
    } catch (primaryErr) {
      // If processStagedUpload fails at any point after ownership transfer, VaultService cleans up tempPath.
      // Note: If temp was already cleaned (or failed) inside the mutex critical section, removeTempFile
      // uses fs.rm({ force: true }) which is a no-op when the file doesn't exist — safe to call.
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
          `Upload processing failed, and temporary file cleanup also failed; file is orphaned at '${tempPath}'`,
          {
            tempPath,
            partialUploadOrphaned: true,
            primaryCause: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
            cleanupCause: cleanupErrMessage,
          }
        );
      }

      throw primaryErr;
    }
  }

  return {
    async uploadAsset(input) {
      const stagedInfo = await storageService.stageFile(input.fileBuffer, input.originalFilename);
      return processStagedUpload(
        stagedInfo,
        input.originalFilename,
        input.mimeType,
        input.vaultRole,
        input.brandId,
        input.productId,
        input.title
      );
    },

    async uploadStream(input) {
      const stagedInfo = await storageService.stageStream(input.fileStream, input.originalFilename);
      return processStagedUpload(
        stagedInfo,
        input.originalFilename,
        input.mimeType,
        input.vaultRole,
        input.brandId,
        input.productId,
        input.title
      );
    },

    async uploadStaged(input) {
      return processStagedUpload(
        input.stagedInfo,
        input.originalFilename,
        input.mimeType,
        input.vaultRole,
        input.brandId,
        input.productId,
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
