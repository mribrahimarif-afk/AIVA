# AIVA Studio

**A**utonomous **I**ntelligent **V**ideo **A**ssembly & Asset Intelligence Engine.

AIVA Studio is a personal-use application for assembling video projects from
scripts, voice, and stock/AI-generated assets.

This repository contains **TASK-001** (foundation), **TASK-002** (AIVA Vault: Brand, Product & Media Asset Library), **TASK-003** (AIVA Director: Gemini-Powered Script Intelligence & Scene Planning V1), and **TASK-004** (AIVA Voice: Azure Neural TTS + Exact Source-Aligned Word Timing V1).

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

`npx prisma migrate deploy` ensures `prisma/dev.db` is created and all migrations (`20260826121100_init`, `20260827020000_vault_brand_product_assets`, `20260827080000_director_scene_plan`, `20260827140000_voice_track_boundaries`) are applied cleanly before startup. `src/infrastructure/db/client.ts` automatically creates the parent `prisma/` directory if missing, preventing SQLite Error Code 14 (`Unable to open the database file`).

## Environment Configuration

Key configuration options in [.env.example](.env.example):

- `DATABASE_URL` — SQLite file location (default: `file:./dev.db`, which resolves to `<repo>/prisma/dev.db`)
- `AIVA_STORAGE_ROOT` — root directory for all managed files (default: `./storage`)
- `AIVA_MAX_UPLOAD_BYTES` — maximum upload payload size in bytes (default: `524288000` = 500 MB)
- `AIVA_DEFAULT_ASPECT_RATIO` — default aspect ratio (`9:16` | `16:9` | `1:1`)
- `AIVA_LOG_LEVEL` — logging level (`debug` | `info` | `warn` | `error`)
- `GEMINI_API_KEY` — Google Gemini API key (server-only secret; Director reports unconfigured if empty)
- `GEMINI_MODEL` — Gemini model identifier (default: `gemini-3.7-flash`)
- `GEMINI_TIMEOUT_MS` — timeout for Gemini API calls in ms (default: `45000`)
- `DIRECTOR_MAX_SCRIPT_CHARS` — maximum allowed script character count (default: `50000`)
- `AZURE_SPEECH_KEY` — Azure Speech API key (server-only secret; Voice reports unconfigured if empty)
- `AZURE_SPEECH_REGION` — Azure Speech service region (e.g. `eastus`)
- `AZURE_SPEECH_VOICE` — default neural voice profile (default: `ur-PK-AsadNeural`)
- `VOICE_MAX_DURATION_MS` — maximum voice duration in ms (default: `600000`)
- `VOICE_SYNTHESIS_TIMEOUT_MS` — timeout for Azure speech synthesis in ms (default: `60000`)
- `VOICE_MAX_AUDIO_BYTES` — maximum allowed audio byte size (default: `67108864` = 64 MB, bounded by 100 MB hard cap)

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
