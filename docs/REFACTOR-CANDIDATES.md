# Refactor candidates — factorisation / consolidation

An audit of duplicated code, made 2026-11-10. Points 1-4 were done right after
(one commit each); points 5-7 are **open** and recorded here so they are not
re-discovered from scratch. "Do not consolidate" at the bottom is as much a part
of this file as the rest.

## Done (2026-11-10)

1. **Narrowing-filter codec.** `search`/`mediaTypes`/`min-maxScore`/`min-maxYear`/
   `genres` were re-parsed by hand in 7 URL hooks and 6 API routes, each with its
   own `num`/`csv`. Now one client codec in `lib/url/narrowingParams.ts` and one
   server parser beside it, pinned by a round-trip test.
2. **Id-set stores.** `user/hidden.json`, `user/reco_ignored.json` and
   `user/seed_mutes.json` were three byte-identical read/add/remove blocks. Now
   `createIdSetStore(file)` in `lib/store/idSet.ts`; each module keeps its own
   filing (`store/` vs `reco/`) and `hidden` still invalidates the row cache.
3. **Toggle routes.** `hide`, `seed-mute`, `reco-credit` and
   `recommendations/ignore/[id]` shared the same POST-adds / DELETE-removes body.
   Now `idToggleRoute()` in `lib/api/idToggleRoute.ts`.
4. **Pure duplicates.** `/catch-up`'s private `byAirDate` (a copy of
   `leanRow.ts`'s), `toNum` redefined in `anilist/cast.ts` and `anilist/push.ts`
   (exported by `store/registry.ts`), and the poster fallback
   `mainPicture?.medium || mainPicture?.large`, written out ~16 times.

## Open — medium value, not scheduled

### 5. OAuth CSRF state
`saveOAuthState` / `consumeOAuthState` are near-identical in
`providers/simkl/client.ts` and `providers/anilist/auth.ts` (one JSON file under
`auth/oauth_state_<provider>.json`, a TTL, consume-once). A
`oauthStateStore(provider)` factory would replace both. **MAL stays apart**: its
file carries a PKCE code verifier, not just a CSRF state. Keep AniList's tolerant
callback (missing `state` accepted) in the route — that is a per-provider rule,
not part of the store.

### 6. Single-flight locks on long-running jobs
Eight module-level booleans (`isCastSweepRunning`, `isPushRunning`,
`anilistMetaSyncRunning`, `isAnilistCatalogCrawlRunning`, `catalogSweepRunning`,
`isRunning` in cronSync, `isHistoricalCrawlRunning`, `isRefreshRunning`) all do:
check → `appendLog(channel, 'info', '… already running')` → return a result with
`alreadyRunning: true` → `try/finally` reset. A `singleFlight(channel)` helper
returning `{ isRunning(), run(fn, onBusy) }` would remove the boilerplate.
Modest gain: every job has its own result shape, so `onBusy` stays per job.
⚠️ The catalog crawl's lock is SHARED between the bulk and single-season crawls,
and cron-sync's lock covers orchestration only (see CLAUDE.md) — a helper must
not turn either into something narrower or wider.

### 7. Split the two 1,500-line modules (no behaviour change)
- `providers/anilist/sync.ts` holds six operations: meta sync, catalog crawl
  (single season + bulk), historical crawl, discovery, catalog sweep,
  recommendations fetch. Split into `anilist/meta.ts`, `anilist/crawl.ts`,
  `anilist/recommendations.ts`, … with `sync.ts` as a barrel so importers do not
  move. The queries stay with their callers (CLAUDE.md: `client.ts` knows nothing
  about them).
- `mcp/tools.ts` — split by tool family (catalog, reco, stats/tier, boxes/groups);
  `server.ts` keeps the schemas.

### Also noticed, lower still
- **57 of 58 API routes** hand-write the method guard (`setHeader('Allow', …)` +
  405). A small `apiHandler({ GET, POST })` dispatcher could absorb it, adopted
  file by file when a route is touched anyway, never as a sweep.
- **Client toggles** (`method: x ? 'POST' : 'DELETE'`, optimistic + revert) appear
  in `index.tsx`, `recommendations.tsx` (×2), `PersonalStateEditor`, and both
  favourites hooks. A `useOptimisticToggle` hook is possible but each call site
  reverts different state.

## Do NOT consolidate

- **The per-page URL hooks themselves.** Each page's state shape is deliberate
  (CLAUDE.md: `/recommendations`, `/tier`, `/quick-rate`… each own theirs). Only
  the shared narrowing codec is factored out.
- **Per-provider sync actions and writers.** MAL's seasonal crawl, SIMKL's delta
  and AniList's GraphQL batch are different operations (docs/DECISIONS.md); only
  enablement and reporting are uniform.
- **`useSeiyuuFavorites` / `useCharacterFavorites`.** Similar today but already
  diverging (no `pending` on characters, refresh-after-success there). Merging
  costs more than it saves at ~55 lines each.
- **`compareByAirDate` (franchiseOrder) into `leanRow.byAirDate`.** Same intent,
  but franchiseOrder's undated sentinel is pinned by its own test and its tie-break
  differs; folding them is a behaviour question, not a deduplication.
