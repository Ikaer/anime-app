# GitHub Copilot Instructions

## General Guidelines
- Always prioritize refactoring over duplication.
- Proactively suggest refactors when you see an opportunity.

## Project Overview

Anime Tracker — a MyAnimeList integration app for anime tracking, built with Next.js 14, TypeScript, and deployed via Docker on a Synology NAS.

## Directory Structure
```
src/
├── components/
│   ├── shared/           # Reusable components (Button, CollapsibleSection)
│   └── anime/            # Anime tracking components
│       └── sidebar/      # Sidebar section components
├── models/
│   ├── shared/           # Common utility types
│   └── anime/            # Anime domain models
├── pages/
│   ├── api/anime/        # Anime API endpoints
│   └── index.tsx         # Main anime page
├── hooks/                # Custom hooks (useAnimeUrlState)
├── lib/                  # Data operations & utilities, split by owner
│   ├── store/            # jsonStore (DATA_PATH primitives) + the local record
│   ├── providers/        # capabilities/registry/status/writers + mal|simkl|anilist pipes
│   ├── reco/             # recommendation engine, weights, credit similarity
│   ├── domain/           # pure & client-safe: animeUtils, stats, ratingGrids, searchLinks
│   ├── url/              # URL state encoding (animeParams.ts)
│   └── config/           # settings.ts, connectionLog.ts
└── styles/
    └── globals.css       # Global theme (CSS custom properties)
```

## Technology Stack

- **Frontend**: Next.js 14.0.0, React, TypeScript
- **Styling**: CSS Modules + global CSS custom properties
- **API**: Next.js API routes (Pages Router)
- **Data**: JSON files with Node.js fs operations
- **Deployment**: Docker with Portainer integration
- **Target**: TV browser (4K) - dark theme only

## Styling Guidelines

- Dark theme only (optimized for TV viewing at 300% zoom)
- CSS custom properties for colors in `globals.css`
- CSS Modules for component-specific styling
- File naming: `ComponentName.module.css`
- Class naming: camelCase
- CSS Modules typings generated via `typed-css-modules`
- Run `npm run css:types` to regenerate typings after CSS changes

## Code Conventions

### Import Patterns
```typescript
import { AnimeTable } from '@/components/anime';
import { AnimeForDisplay } from '@/models/anime';
import { Button, CollapsibleSection } from '@/components/shared';
```

### Data Storage
- JSON file-based storage in `/app/data/`
- `lib/store/jsonStore.ts` owns `dataFile`/`readJsonFile`/`writeJsonFile`; above it `store/` is `registry.ts` (canonical ids) → `slices.ts` (one block per JSON file) → `record.ts` (the join), behind an `index.ts` barrel
- Automatic directory creation via `ensureDataDirectory()`

### API Routes
All under `/api/anime/`:
- `/api/anime/animes` — list/search anime
- `/api/anime/animes/[id]/hide` — hide/unhide anime
- `/api/anime/animes/[id]/mal-status` — update MAL watch status
- `/api/anime/auth` — MAL OAuth flow
- `/api/anime/mal/sync` — manual sync
- `/api/anime/mal/big-sync` — full seasonal sync
- `/api/anime/cron-sync` — cron-triggered sync

## Environment & Deployment

### Docker Configuration
- Multi-stage build with Node.js 18-alpine
- Port mapping: 12344:3000
- Volume mounts: data + logs

### File Paths
- Data: `/app/data/` (anime JSON files in `anime/` subdirectory)
- Logs: `/app/logs/`

### Environment Variables
- `DATA_PATH` — data directory root
- `LOGS_PATH` — diagnostics directory (no writer today; the connection log lives in the store at `DATA_PATH/logs/`)
- `MAL_CLIENT_ID` — MyAnimeList API client ID
- `MAL_REDIRECT_URI` — OAuth redirect URI
- `CRON_SECRET` — cron job auth token