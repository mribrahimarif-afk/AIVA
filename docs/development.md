# Development Guide

## Workflow

1. `npm install`
2. `cp .env.example .env`
3. `npx prisma migrate dev`
4. `npm run dev`

## Adding a new domain concept

Follow the existing pattern for `Project`/`Brand`/`Scene`/`Asset`:

1. **Schema**: add the model to `prisma/schema.prisma`, run
   `npx prisma migrate dev --name <description>`.
2. **Domain**: add `src/domain/<name>/<name>.types.ts` (plain TS types,
   `as const` tuples for any enumerated field) and
   `<name>.schema.ts` (Zod schemas derived from those tuples).
3. **Repository**: add `src/repositories/<name>.repository.ts` — a thin
   Prisma wrapper returning domain types via `src/repositories/mappers.ts`.
4. **Service**: if the operation needs orchestration beyond a single
   database write (e.g. touching the filesystem, coordinating multiple
   repositories), add it to `src/services/`. Simple reads can go straight
   from a page/route to a repository.
5. **UI**: pages/components call the service or repository; they must not
   contain validation or orchestration logic themselves.

## Conventions

- **No `any`.** TypeScript strict mode is on; prefer `unknown` at
  boundaries (API request bodies, raw env vars) and narrow with Zod.
- **All filesystem access goes through `src/storage`.** Don't call
  `node:fs` directly from services, routes, or components.
- **All errors thrown from services/repositories extend `AivaError`.**
  API routes convert them to responses via
  `src/infrastructure/http/error-response.ts`; don't hand-roll
  `try/catch` → `NextResponse.json` logic per route.
- **Never log secrets.** The logger redacts common secret-shaped keys
  automatically, but avoid passing raw provider credentials into log
  context in the first place.
- **Cross-platform paths.** Use `node:path` (`path.join`/`path.resolve`),
  never string-concatenate path segments — Windows and POSIX separators
  both need to work.

## Testing strategy

Tests live under `tests/`, split into `unit/` and `integration/`, and run
with Vitest (`npm test`).

- **Unit tests** (`tests/unit/`) exercise pure logic with no I/O: Zod
  schema validation, path-building helpers, and the storage service
  against the real filesystem (using temporary, uniquely-named project
  IDs so tests don't collide).
- **Integration tests** (`tests/integration/`) exercise the real stack:
  Prisma against a dedicated SQLite database (`prisma/test.db`), the
  project repository/service end to end, and the `/api/health` route
  handler invoked directly.

### Test database and storage isolation

`vitest.config.ts` wires two setup mechanisms:

- `globalSetup` (`tests/setup/global-setup.ts`) runs once before the whole
  suite: it deletes any leftover `prisma/test.db`, then runs
  `prisma migrate deploy` against it so integration tests exercise the
  same migration files used in production — not `prisma db push`. It
  deletes the test database and scratch storage directory again after the
  suite finishes.
- `setupFiles` (`tests/setup/env.ts`) runs before each test file and
  points `DATABASE_URL` at `prisma/test.db` and `AIVA_STORAGE_ROOT` at a
  `.test-storage/` scratch directory, so tests never touch your
  development database (`prisma/dev.db`) or `storage/` directory.

Both `prisma/test.db` and `.test-storage/` are git-ignored.

## Verifying a change

Before considering a change complete:

```bash
npm run typecheck
npm test
npm run build
```

For UI changes, also run `npm run dev` and click through the affected
flow in a browser — type checks and unit tests confirm correctness, not
that a form actually submits or a page actually renders.
