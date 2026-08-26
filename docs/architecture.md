# Architecture

AIVA Studio is a Next.js (App Router) application written in TypeScript
with strict mode enabled throughout. TASK-001 establishes the layering and
module boundaries that later tasks (scene intelligence, provider
integrations, rendering) will build on top of, without implementing any of
that functionality yet.

## Layers

```
src/
  app/              Next.js routes: pages (server components) + API route handlers.
                     No domain logic — pages call services/repositories and render.
  components/       React components (UI only). No domain logic, no direct
                     Prisma/filesystem access.
  domain/           Framework-free types, Zod schemas, and error classes.
                     The single source of truth for entity shapes and
                     validation rules (project, brand, scene, asset, errors).
  services/         Application/orchestration layer. Validates input via
                     domain schemas, coordinates repositories + storage,
                     and is what routes/pages call into.
  repositories/     Data access layer. One repository per aggregate
                     (Project, Brand, Scene, Asset), each a thin wrapper
                     around Prisma that maps rows to domain types.
  providers/        Interfaces only for future external integrations
                     (AI, voice, stock, video). No implementations exist
                     in TASK-001.
  infrastructure/   Cross-cutting concerns: environment config (Zod-
                     validated), the Prisma client singleton, structured
                     logging, FFmpeg detection, HTTP error mapping.
  storage/          Centralized filesystem operations: path resolution
                     and workspace initialization. Nothing outside this
                     module should call `fs` directly for AIVA-managed
                     paths.
```

Dependency direction is one-way: `app`/`components` → `services` →
`repositories`/`storage`/`providers` → `infrastructure`/`domain`. Domain
types and errors have no dependencies on anything else, so they can be
imported from any layer.

### Why services own orchestration, not repositories or routes

Project creation needs to (1) validate input, (2) write a database row,
and (3) initialize an on-disk workspace, rolling the database row back if
step 3 fails. That coordination belongs in exactly one place —
`services/project.service.ts` — rather than being duplicated across API
routes and page components, or leaking into the repository (which should
stay a dumb data-access layer).

### Why status/type enums are plain TypeScript, not Prisma enums

SQLite's Prisma connector doesn't support native enum columns. All
enumerated fields (`Project.status`, `Project.aspectRatio`, `Scene.status`,
`Asset.type`, `Asset.source`) are stored as `String` in the schema; the
authoritative set of allowed values lives in `src/domain/*/*.types.ts` as
`as const` tuples, with matching Zod schemas in `*.schema.ts`. Because
SQLite itself enforces no constraint on these columns, `src/repositories/mappers.ts`
re-validates the stored string against the matching Zod schema when
mapping a Prisma row to a domain object, rather than blindly casting it —
a row with a corrupted or hand-edited status/type value throws a
`DataIntegrityError` instead of silently becoming a "valid" domain object
with a status the rest of the app doesn't know how to handle.

## Provider abstractions (interfaces only)

`src/providers/{ai,voice,stock,video}` each export a single interface
(`AiProvider`, `VoiceProvider`, `StockProvider`, `VideoProcessingProvider`)
describing the contract a future integration (Gemini, Azure Speech,
Pexels/Pixabay) or local processing step will implement. TASK-001
intentionally does not:

- implement any of these interfaces,
- call any external API,
- read provider API keys for anything other than reporting configuration
  status in Settings (`src/providers/provider-status.ts`).

**AIVA does not have — and will never have — an AI video-generation
provider.** Clips from external tools such as Google Flow/Veo are
produced outside AIVA and manually uploaded through AIVA Intake; they are
never fetched by calling a generation API from within this app.
`VideoProcessingProvider` exists only for future *local* processing of
video files AIVA already has on disk (e.g. an FFmpeg trim/concat/format
step during rendering) — it has no "generate a clip from a prompt"
method, unlike the other three provider interfaces which do model calling
an external generation/lookup API.

This keeps the seam where those integrations will land explicit and
typed, without pulling any of that scope into this task.

## Error model

`src/domain/errors/` defines a small hierarchy rooted at `AivaError`
(abstract base with `code`, `httpStatus`, optional `details`):

- `ValidationError` (400) — input failed a Zod schema
- `NotFoundError` (404) — a requested entity doesn't exist
- `StorageError` (500) — a filesystem operation failed
- `ProviderError` (502) — reserved for future provider adapters
- `RenderError` (500) — reserved for the future rendering pipeline
- `DataIntegrityError` (500) — a value read back from the database failed
  its own domain schema (see the mapper note above)

`src/infrastructure/http/error-response.ts` is the single place that turns
a thrown error into an HTTP response for API routes, so error handling
isn't reimplemented per route. **Server-fault errors (httpStatus ≥ 500)
never expose their `message` or `details` to the client** — a
`StorageError`'s `details` can contain a filesystem path, a
`ProviderError`'s could someday contain an upstream response body — the
client gets a generic message while the full error (still passed through
the logger's redaction) is logged for operators. Only client-fault errors
(400/404) keep their real message/details, since the UI depends on them
(e.g. `ValidationError`'s `details.fieldErrors`).

## Health checks

`GET /api/health` (`src/app/api/health/route.ts`) aggregates three
independent checks — database (`SELECT 1`), storage, and FFmpeg (binary
detected on `PATH` or at `AIVA_FFMPEG_PATH`) — into one report. The
storage check does more than confirm the directory tree exists (a
`mkdir(recursive: true)` on an already-present tree succeeds even if it's
read-only): it also writes and deletes a small probe file
(`storageService.verifyWritable()`) so a storage root that exists but
isn't writable is correctly reported as `DOWN`, not `OK`. FFmpeg being
unavailable degrades the overall status to `DEGRADED` rather than failing
the check or crashing the app; only a database or storage failure
produces `DOWN` (HTTP 503).

## Logging

`src/infrastructure/logging/logger.ts` emits one JSON object per line with
a fixed set of structured fields (`timestamp`, `level`, `event`,
`projectId`, `sceneId`, `provider`, `durationMs`, `message`, `error`, plus
arbitrary extra context). Redaction happens at two levels, both enforced
centrally in the logger rather than left to call sites to remember:

- any object **key** matching a secret-shaped pattern (`apiKey`, `token`,
  `password`, `authorization`, etc.) is redacted recursively, regardless
  of nesting depth;
- every string **value** — including the top-level `message`, and a
  serialized `Error`'s `message`/`stack` — is separately scanned for
  secret-shaped *content* (`key: value`/`key=value` pairs, `Bearer <token>`,
  and common provider token prefixes) and redacted in place. This matters
  because a future provider adapter's thrown error is unlikely to put a
  credential behind a conveniently-named key — it's far more likely to
  end up as plain text inside an HTTP client's error message or stack
  trace, which key-based redaction alone would miss.

## TASK-001 scope and non-goals

TASK-001 delivers architecture, database, storage, settings foundation,
health diagnostics, logging, error types, tests, and a minimal UI only. It
explicitly does **not** implement: Gemini/Azure Speech/Pexels/Pixabay
integrations, AI video generation, Google Flow, FFmpeg rendering, scene
intelligence, stock ranking, product matching intelligence, subtitles,
music, SFX, or final video generation. Project status values beyond
`DRAFT` exist in the schema/domain model as future-safe placeholders but
nothing in this task transitions a project into them.
