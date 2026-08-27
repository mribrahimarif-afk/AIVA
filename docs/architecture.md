# Architecture

AIVA Studio is a Next.js (App Router) application written in TypeScript
with strict mode enabled throughout.

## Layers

```
src/
  app/              Next.js routes: pages (server components) + API route handlers.
                     No domain logic — pages call services/repositories and render.
  components/       React components (UI only). No domain logic, no direct
                     Prisma/filesystem access.
  domain/           Framework-free types, Zod schemas, and error classes.
                     The single source of truth for entity shapes and
                     validation rules (project, brand, product, scene, asset, errors).
  services/         Application/orchestration layer. Validates input via
                     domain schemas, coordinates repositories + storage,
                     and is what routes/pages call into.
  repositories/     Data access layer. One repository per aggregate
                     (Project, Brand, Product, ContentBlob, Scene, Asset), each a thin wrapper
                     around Prisma that maps rows to domain types.
  providers/        Interfaces only for future external integrations
                     (AI, voice, stock, video). No implementations exist
                     in TASK-001/TASK-002.
  infrastructure/   Cross-cutting concerns: environment config (Zod-
                     validated), the Prisma client singleton, structured
                     logging, FFmpeg detection, HTTP error mapping.
  storage/          Centralized filesystem operations: path resolution,
                     workspace initialization, file staging, SHA-256 calculation,
                     and canonical blob finalization.
```

Dependency direction is one-way: `app`/`components` → `services` →
`repositories`/`storage`/`providers` → `infrastructure`/`domain`. Domain
types and errors have no dependencies on anything else, so they can be
imported from any layer.

### TASK-002 AIVA Vault Architecture

TASK-002 introduces AIVA Vault: a permanent local asset library and brand/product metadata system.

#### 1. Brand & Product Hierarchy
- **`Brand`**: Represents an organization or client (name, unique `slug`).
- **`Product`**: Belongs to exactly one Brand (`brandId` FK, unique `(brandId, slug)`).
- **`ProductAlias`**: Alternate names for products (e.g. abbreviations, Urdu/English transliterations) to allow future AIVA intelligence to recognize product references. Aliases are normalized (trimmed, lowercased, whitespace-normalized) with a unique `(productId, normalizedAlias)` constraint.

#### 2. Vault Classification Concepts (`VaultRole`)
Vault assets introduce an explicit `VaultRole` classification to separate physical file storage from logical library role:
- `BRAND_LOGO` (allowed: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`)
- `PRODUCT_VIDEO` (allowed: `.mp4`, `.mov`, `.webm`)
- `MUSIC` (allowed: `.mp3`, `.wav`, `.m4a`, `.aac`)
- `SFX` (allowed: `.mp3`, `.wav`, `.m4a`, `.aac`)
- `OUTRO` (allowed: `.mp4`, `.mov`, `.webm`, `.png`, `.jpg`, `.jpeg`, `.webp`)
- `FONT` (allowed: `.ttf`, `.otf`, `.woff`, `.woff2`)
- `BROLL` (allowed: `.mp4`, `.mov`, `.webm`)

Executable files (`.exe`, `.sh`, `.bat`, etc.) are strictly forbidden regardless of renamed extensions.

#### 3. Physical Blob vs Logical Asset Model (`ContentBlob` vs `Asset`)
To prevent duplicate storage of large media binaries:
- **`ContentBlob`**: Represents the physical binary payload stored at `storage/assets/blobs/{ab}/{checksum}.{ext}`. Indexed by unique SHA-256 `checksum`.
- **`Asset`**: Represents a logical library asset (with display title, `vaultRole`, `brandId`, `productId`, `projectId`) pointing to a backing `blobId`.
- **Binary Deduplication**: When an uploaded file matches an existing `ContentBlob`'s SHA-256 hash, the newly staged file is deleted and a new logical `Asset` record is created referencing the pre-existing content blob.

## Error Model & Security

`src/domain/errors/` defines a hierarchy rooted at `AivaError`:
- `ValidationError` (400) — input failed a Zod schema or file role validation
- `NotFoundError` (404) — a requested entity doesn't exist
- `StorageError` (500) — a filesystem operation failed
- `DataIntegrityError` (500) — a value read back from database failed domain validation

Server-fault errors (5xx) never expose internal messages or filesystem paths to HTTP clients, returning generic client error responses while logging full redacted context internally.
