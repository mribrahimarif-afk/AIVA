# Storage Layout

All AIVA-managed files live under a single configurable storage root
(`AIVA_STORAGE_ROOT`, default `./storage`, resolved to an absolute path
via `node:path` relative to the process working directory — never a
hard-coded machine path). All access goes through
`src/storage/storage.service.ts` and `src/storage/paths.ts`; nothing else
in the app calls `node:fs` directly for these paths.

## Layout

```
storage/
  projects/
    {project-id}/
      source/      original/uploaded source material
      audio/       generated or uploaded voice audio
      stock/       stock media resolved for this project
      product/     product-specific media
      ai/          AI-generated assets
      captions/    caption/subtitle data
      timeline/    edit timeline data
      renders/     final render output
      temp/        scratch space for this project
  brands/          brand-level assets, shared across projects
  assets/          global asset library
    blobs/         SHA-256 content-addressable permanent binary blobs
      {ab}/        2-character hex prefix subdirectories (e.g. e3/)
        {sha256}.{ext}  canonical binary content file
  cache/           derived/cacheable data
  temp/            global scratch space for safe upload staging
```

## TASK-002 Vault Storage & Binary Deduplication

1. **Content-Addressable Storage**:
   - Files uploaded to AIVA Vault are staged in `storage/temp/upload-{uuid}-{filename}`.
   - SHA-256 hash is computed while writing the staged temp file.
   - The file is finalized to its canonical location: `storage/assets/blobs/{ab}/{checksum}.{ext}`.
   - Relative storage paths (e.g. `assets/blobs/e3/e3b0c44...mp4`) are stored in database records (`ContentBlob.storagePath`), keeping database records fully portable regardless of machine or `AIVA_STORAGE_ROOT` location.

2. **Deduplication Strategy**:
   - If an uploaded binary has a SHA-256 hash that matches an existing `ContentBlob`, the temporary staged file is immediately removed.
   - A new logical `Asset` record is created pointing to the existing `ContentBlob` and storage file, marked with `metadata.deduplicated = true`.
   - Physical disk space is consumed **ONLY ONCE** per unique binary payload.

3. **Guarantees**:
   - **Idempotent**: `storageService.initializeGlobalStorage()` ensures all skeleton directories (`brands/`, `assets/`, `assets/blobs/`, `cache/`, `temp/`) exist.
   - **Fail-Closed Existence Check**: Existence probes (`pathExists`, `projectWorkspaceExists`) return `false` ONLY for `ENOENT`. Permission or I/O errors throw a controlled `StorageError`, protecting existing workspace files from destructive cleanup.
   - **No Hard-Coded Machine Paths**: All paths are resolved dynamically via `node:path`.
   - **Path Traversal Protection**: Uploaded filenames are sanitized (`path.basename`) and checked against forbidden executable extensions (`.exe`, `.sh`, `.bat`, etc.).

## Atomicity & Failure Handling

- If staging or DB insert fails during upload, temporary staged files are deleted immediately.
- If cleanup fails, structured `StorageError` with `partialUploadOrphaned: true` is thrown and logged.
- Pre-existing canonical storage blobs are **NEVER** deleted during failed or retried upload attempts.
