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
├── lib/                  # Server-side data operations & utilities
│   ├── anime.ts          # MAL data, sync, auth (server-side)
│   ├── animeUtils.ts     # Anime filtering & sorting logic
│   ├── animeUrlParams.ts # URL state parsing
│   └── providers.ts      # Streaming provider definitions
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
import { AnimeWithExtensions } from '@/models/anime';
import { Button, CollapsibleSection } from '@/components/shared';
```

### Data Storage
- JSON file-based storage in `/app/data/`
- `lib/anime.ts` has its own `readJsonFile`/`writeJsonFile` utilities
- Automatic directory creation via `ensureDataDirectory()`

### API Routes
All under `/api/anime/`:
- `/api/anime/animes` — list/search anime
- `/api/anime/animes/[id]` — single anime operations
- `/api/anime/animes/[id]/extensions` — user extensions (providers, notes)
- `/api/anime/animes/[id]/hide` — hide/unhide anime
- `/api/anime/animes/[id]/mal-status` — update MAL watch status
- `/api/anime/animes/[id]/providers` — streaming providers
- `/api/anime/auth` — MAL OAuth flow
- `/api/anime/sync` — manual sync
- `/api/anime/big-sync` — full seasonal sync
- `/api/anime/cron-sync` — cron-triggered sync
- `/api/anime/discover-providers` — provider discovery

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
- `LOGS_PATH` — logs directory
- `MAL_CLIENT_ID` — MyAnimeList API client ID
- `MAL_REDIRECT_URI` — OAuth redirect URI
- `CRON_SECRET` — cron job auth token