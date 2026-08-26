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
  assets/          global asset library, not tied to one project
  cache/           derived/cacheable data
  temp/            global scratch space
```

## Guarantees

- **Idempotent**: every directory is created with `fs.mkdir(path, { recursive: true })`,
  which is a no-op if the directory already exists. Re-running
  initialization never deletes or truncates existing files.
- **Restart-safe**: `storageService.initializeGlobalStorage()` runs once
  per server process (cached via a module-level promise in
  `src/app/layout.tsx`) but is safe to call any number of times — on
  every app restart, the skeleton is verified/recreated rather than
  assumed to exist.
- **Deterministic initialization**: the global skeleton (`projects/`,
  `brands/`, `assets/`, `cache/`, `temp/`) is guaranteed to exist before
  any page renders. A project's workspace is created synchronously as
  part of project creation (`ProjectService.createProject`), not lazily
  on first use.
- **No hard-coded machine paths**: the storage root is read from
  `AIVA_STORAGE_ROOT` and resolved with `path.resolve`/`path.isAbsolute`;
  every other path is built with `path.join` from that root.
- **Path-safety**: project IDs are validated against
  `^[a-zA-Z0-9_-]+$` before being joined into a filesystem path, rejecting
  path traversal or separator characters.

## Rollback on partial failure

If workspace creation fails after the project's database row has already
been created, `ProjectService.createProject` deletes the row it just
created so the system never ends up with a project that has no backing
storage. This is the one place storage and database writes are
coordinated; see `src/services/project.service.ts`.

## What TASK-001 does not do

No rendering, provider downloads, or asset processing writes into these
directories yet — TASK-001 only creates the empty directory structure.
Later tasks will populate `audio/`, `stock/`, `ai/`, etc. as the relevant
pipeline stages are implemented.
