# AIVA Studio

**A**utonomous **I**ntelligent **V**ideo **A**ssembly & Asset Intelligence Engine.

AIVA Studio is a personal-use application for assembling video projects from
scripts, voice, and stock/AI-generated assets. This repository currently
contains **TASK-001: foundation** — the application architecture, database,
storage workspace management, domain models, settings, health diagnostics,
logging, and a minimal UI. No AI/voice/stock provider, rendering, or
scene-intelligence functionality is implemented yet (see
[docs/architecture.md](docs/architecture.md) for scope and non-goals).

## Prerequisites

- Node.js 20 or later
- npm 10 or later
- (Optional) FFmpeg installed and on your `PATH`, or a path to an FFmpeg
  binary — used only for detection/health reporting in this task, not
  rendering.

## Installation

```bash
npm install
```

`npm install` also runs `prisma generate` via `postinstall`, so the Prisma
client is ready immediately after install.

## Environment setup

Copy the example environment file and adjust values as needed:

```bash
cp .env.example .env
```

See [.env.example](.env.example) for the full list of variables. The
defaults work out of the box for local development:

- `DATABASE_URL` — SQLite file location (defaults to `./prisma/dev.db`)
- `AIVA_STORAGE_ROOT` — root directory for all managed files (defaults to
  `./storage`)
- `AIVA_FFMPEG_PATH` — optional explicit FFmpeg binary path
- `AIVA_DEFAULT_ASPECT_RATIO` — one of `9:16` | `16:9` | `1:1`
- `AIVA_LOG_LEVEL` — one of `debug` | `info` | `warn` | `error`
- `GEMINI_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`,
  `PEXELS_API_KEY`, `PIXABAY_API_KEY` — placeholders only. TASK-001 never
  reads or uses these; they exist so the Settings screen can report
  configuration status ahead of the provider integrations that will use
  them in later tasks.

Never commit your real `.env` file.

## Database setup

The database schema is managed with Prisma migrations against a local
SQLite file.

```bash
npx prisma migrate dev
```

This creates `prisma/dev.db` (or your configured `DATABASE_URL`) and
applies all migrations in `prisma/migrations/`. Re-running it is safe.

## Development

```bash
npm run dev
```

Then open http://localhost:3000. On first request, the app deterministically
creates the global storage skeleton (`storage/projects`, `storage/brands`,
`storage/assets`, `storage/cache`, `storage/temp`) if it doesn't already
exist — see [docs/storage-layout.md](docs/storage-layout.md).

Other useful scripts:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # next lint
```

## Tests

```bash
npm test
```

Runs the full unit + integration suite once with Vitest. Integration tests
apply real Prisma migrations to an isolated `prisma/test.db` (created and
torn down automatically) and exercise a scratch `.test-storage/` directory,
so they never touch your development database or storage root.

```bash
npm run test:watch  # watch mode
```

## Build

```bash
npm run build
```

Produces a production build (`next build`), including a full TypeScript
type check.

```bash
npm start   # run the production build
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — layering, module
  boundaries, provider abstractions, and TASK-001 scope/non-goals
- [docs/development.md](docs/development.md) — day-to-day development
  workflow, conventions, and testing strategy
- [docs/storage-layout.md](docs/storage-layout.md) — on-disk storage
  layout and the guarantees the storage service provides
