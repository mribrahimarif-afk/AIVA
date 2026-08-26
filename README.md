# AIVA Studio

**A**utonomous **I**ntelligent **V**ideo **A**ssembly & Asset Intelligence Engine.

AIVA Studio is a personal-use application for assembling video projects from
scripts, voice, and stock/AI-generated assets.

This repository contains **TASK-001** (foundation) & **TASK-002** (AIVA Vault: Brand, Product & Media Asset Library).

## Prerequisites

- Node.js 20 or later
- npm 10 or later
- (Optional) FFmpeg installed on `PATH` or configured via `AIVA_FFMPEG_PATH`.

## Installation & Deterministic Local Setup

To set up a fresh local workspace deterministically from clone:

```bash
npm ci
cp .env.example .env
npx prisma generate
npx prisma migrate deploy
npm run dev
```

`npx prisma migrate deploy` ensures `prisma/dev.db` is created and all migrations (`20260826121100_init`, `20260827020000_vault_brand_product_assets`) are applied cleanly before startup. `src/infrastructure/db/client.ts` automatically creates the parent `prisma/` directory if missing, preventing SQLite Error Code 14 (`Unable to open the database file`).

## Environment Configuration

Key configuration options in [.env.example](.env.example):

- `DATABASE_URL` — SQLite file location (default: `file:./prisma/dev.db`)
- `AIVA_STORAGE_ROOT` — root directory for all managed files (default: `./storage`)
- `AIVA_MAX_UPLOAD_BYTES` — maximum upload payload size in bytes (default: `524288000` = 500 MB)
- `AIVA_DEFAULT_ASPECT_RATIO` — default aspect ratio (`9:16` | `16:9` | `1:1`)
- `AIVA_LOG_LEVEL` — logging level (`debug` | `info` | `warn` | `error`)

## Key Commands

```bash
npm run dev        # Starts Next.js dev server on http://localhost:3000
npm run typecheck  # TypeScript strict type checking
npm run lint       # ESLint lint check
npm test           # Vitest unit & integration test suite
npm run build      # Next.js production build
```

## Documentation

- [docs/architecture.md](docs/architecture.md) — system architecture, Vault Brand/Product model, and error handling
- [docs/storage-layout.md](docs/storage-layout.md) — on-disk storage layout, content-addressable blobs, and deduplication guarantees
