# Anime Tracker

A MyAnimeList integration app for anime tracking, built with Next.js 14, TypeScript, and deployed via Docker on a Synology NAS.

## Development

1. Install dependencies:
```bash
npm install
```

2. Run development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

## Docker Deployment

1. Make sure the data directories exist on your NAS:
```bash
mkdir -p /volume4/root4/AppData/AnimeTracker/data
mkdir -p /volume4/root4/AppData/AnimeTracker/logs
```

2. Build and run:
```bash
docker-compose up -d
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:
- `MAL_CLIENT_ID` — MyAnimeList API client ID ([get one here](https://myanimelist.net/apiconfig))
- `MAL_REDIRECT_URI` — OAuth redirect URI (should match what you set in MAL API config, e.g., `http://[NAS_IP]:12350/api/auth/callback`)
- `CRON_SECRET` — secret for cron job authentication
optional;
- `BUILD_VERSION` — ideal to force cache busting 

## Access

Once deployed, access at: `http://[NAS_IP]:12350`

