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

### TASK-003 AIVA Director Architecture

TASK-003 introduces AIVA Director V1: a structured script intelligence and scene planning engine powered by Google Gemini with strict local script fidelity guarantees.

#### 1. End-to-End Pipeline
```
User Script
    ↓
Script Unitizer (Deterministic local chunking into ScriptUnits: [start, end) spans)
    ↓
Gemini Director Analysis (Prompt injection defense + structured output of Unit IDs)
    ↓
Local Validation (10 coverage invariants + cross-field rules + bounded constraints)
    ↓ (At most 1 bounded repair attempt if invalid)
Local Narration Reconstruction (scene.text = units.join(""))
    ↓
Local Metadata Stamping (schemaVersion, promptVersion, unitizerVersion, scriptHash, generatedAt)
    ↓
Atomic Persistence (DirectorPlan + DirectorScene[] replaced in a single DB transaction)
    ↓
Director UI (Workspace with script form, Brand/Product context, and structured scene cards)
```

#### 2. Deterministic Script Unitization & Narration Fidelity
To ensure zero risk of model hallucination, word dropping, or unauthorized rewrites of commercial voiceover text:
- The user script is split into contiguous `ScriptUnit` records (`u0001`, `u0002`...) before being sent to Gemini.
- Invariant: `reconstructScript(unitizeScript(script)) === script` (100% character-exact roundtrip).
- Gemini is never asked to rewrite narration text; it only assigns `unitIds` to scenes.
- Each scene's narration is reconstructed locally: `scene.text = scene.unitIds.map(id => unitMap.get(id).text).join("")`.

#### 3. 10 Local Coverage & Contiguity Invariants
Every Gemini response must satisfy:
1. Every ScriptUnit appears in the plan.
2. No ScriptUnit is missing.
3. No ScriptUnit is duplicated.
4. No unknown unit IDs are referenced.
5. Unit order is strictly preserved.
6. Units inside each scene are contiguous.
7. Scene sequence numbers are contiguous `1..N`.
8. No empty scenes.
9. Narration is reconstructed locally from ScriptUnits.
10. Recombined scene narration exactly equals original script.

#### 4. Real-Product Packaging & Manual AI Prompt Rules
- **Real-Product Rule**: If `productPresence === "REQUIRED"`, `visualSourceHint` cannot be `MANUAL_AI` (must prefer `PRODUCT_LIBRARY` or `REUSABLE_LIBRARY`). Real packaging must come from canonical asset storage, not generative AI.
- **Manual AI Prompt Rule**: If `visualSourceHint === "MANUAL_AI"`, `manualAiPrompt` is a non-empty descriptive prompt suitable for external tools (e.g. Google Flow / Veo); if not `MANUAL_AI`, `manualAiPrompt` is strictly `null`.
- *Note*: No automated Flow/Veo video generation API calls exist in TASK-003; prompts are provided as text guidance.

#### 5. Scope Boundaries & Non-Goals
TASK-003 explicitly locks the following non-goals for future tasks:
- No Pexels / Pixabay stock retrieval or downloads.
- No vector embeddings or asset ranking.
- No FFmpeg rendering, timeline assembly, music/SFX, captions, or publishing.

### TASK-004 AIVA Voice Architecture

TASK-004 introduces AIVA Voice: Azure Neural Text-to-Speech integration with source-aligned word-boundary timing and single continuous narration audio track synthesis.

#### 1. End-to-End Pipeline Progression
The core AIVA video generation pipeline progresses strictly across stages:
`Director (TASK-003)` → `Voice (TASK-004)` → `future Timeline (TASK-005)`

- **`DirectorPlan.originalScript`** is the authoritative narration source. Input to Azure Speech is strictly plain text with zero SSML, ensuring an uncorrupted character offset mapping `[sourceStart, sourceEnd)` into the original script.
- **Single Continuous Track**: The script is synthesized in its entirety into one continuous narration WAV file (`Riff24Khz16BitMonoPcm` @ 24kHz / 16-bit / Mono). Scene-level timing is strictly derived downstream in TASK-005.

#### 2. Word Boundary Event & Duration Invariants
- **100ns Ticks to Milliseconds**: Azure word boundary event offsets and durations are converted using `10,000 ticks = 1 ms` with a deterministic `Math.round()` policy.
- **Authoritative Audio Duration**: Total narration duration is derived exclusively from the synthesis result's `audioDuration` (in ticks), never inferred from the last word boundary.
- **Source Alignment**: Transient Azure `event.text` is compared against `originalScript.slice(sourceStart, sourceEnd)`. Mismatches fail closed with `WORD_BOUNDARY_ALIGNMENT_FAILED` without mutating the source text.
- **Authoritative Reconstructed Text**: Persisted word text is always derived locally from `originalScript.slice(sourceStart, sourceEnd)`.

#### 3. In-Transaction Concurrency (TOCTOU Defense) & Lifecycle
- **`CURRENT` vs `STALE`**: A `VoiceTrack` stores `sourceScriptHash`. When `DirectorPlan.scriptHash` changes upon script re-analysis, the track transitions to `STALE`.
- **In-Transaction Concurrency Check**: `VoiceTrackRepository.replaceTrack` executes a single Prisma `$transaction` that re-reads `DirectorPlan` and verifies `currentPlan.scriptHash === capturedScriptHash`. If the script was re-analyzed while synthesis was in flight, the transaction aborts with `SOURCE_CHANGED`.
- **Foreign Key Relation**: `VoiceTrack.directorPlanId` is a real foreign key with `onDelete: Cascade` referencing `DirectorPlan.id`.

#### 4. Content-Addressed Storage & V1 Safe Orphan Compensation Policy
- **Content-Addressed Path**: `projects/[projectId]/audio/[audioSha256].wav`.
- **Atomic No-Clobber Publication**: Temporary files are published using atomic exclusive creation (`COPYFILE_EXCL` / link primitive). Racing operations on the same SHA adopt the pre-existing artifact with `newlyCreated = false`.
- **V1 Safe Orphan Policy**: Temporary files are always cleaned. Finalized content-addressed WAV blobs are never synchronously deleted on request-time DB failures or VoiceTrack replacement to eliminate races where another concurrent request adopts the same SHA. Future background maintenance/GC may reclaim unreferenced blobs.

#### 5. Scope Boundaries & Non-Goals
TASK-004 explicitly locks the following non-goals:
- No automatic scene durations or scene start/end assignments (owned by TASK-005 Timeline).
- No Pexels / Pixabay stock retrieval or downloads.
- No vector embeddings or asset ranking.
- No FFmpeg rendering, video assembly, captions, subtitle rendering, music, or SFX.

## Error Model & Security

`src/domain/errors/` defines a hierarchy rooted at `AivaError`:
- `ValidationError` (400) — input failed a Zod schema or file role validation
- `NotFoundError` (404) — a requested entity doesn't exist
- `ProviderError` (500) — an external AI or service provider failed
- `StorageError` (500) — a filesystem operation failed
- `DataIntegrityError` (500) — a value read back from database failed domain validation

Server-fault errors (5xx) never expose internal messages or filesystem paths to HTTP clients, returning generic client error responses while logging full redacted context internally.

