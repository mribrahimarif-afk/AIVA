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
  initialization never deletes or truncates existing files. If a
  subdirectory fails to create partway through
  `initializeProjectWorkspace`, the partially-built tree is removed —
  but only when this call is what created the workspace root; a
  workspace that already existed before the call is never deleted just
  because a later step failed.
- **Verified writable, not just present**: `storageService.verifyWritable()`
  writes and deletes a small probe file under the global temp root.
  `GET /api/health` calls this in addition to
  `initializeGlobalStorage()`, because `mkdir(recursive: true)` on an
  already-existing tree succeeds even if that tree has since become
  read-only — without the probe, health would keep reporting `OK` right
  up until the first real write failed.
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

That rollback delete can itself fail (e.g. the database becomes
unavailable at the same moment). That failure is never silently
swallowed: it's logged as a distinct `project.rollback_failed` event, and
`createProject` throws a `StorageError` with `details.orphaned: true`
instead of the original workspace error, so it's possible to tell "the
project was cleanly rejected" apart from "a project row now exists with
no backing workspace and needs manual cleanup." The storage dependency
(`ProjectWorkspaceInitializer`) and the rollback-capable `db` handle
(`ProjectRollbackDb`) are both narrow, injectable interfaces specifically
so tests can force this failure path without touching the real
filesystem or database — see `tests/integration/project/project-crud.test.ts`.

## What TASK-001 does not do

No rendering, provider downloads, or asset processing writes into these
directories yet — TASK-001 only creates the empty directory structure.
Later tasks will populate `audio/`, `stock/`, `ai/`, etc. as the relevant
pipeline stages are implemented.
