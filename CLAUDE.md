# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server + CSS type watcher (concurrently)
npm run build        # Generates CSS types, then next build
npm run lint         # ESLint via next lint
npm run css:types    # Regenerate CSS Module typings (run after any .module.css change)
```

There are no tests in this project.

## Architecture

**Anime Tracker** — a MyAnimeList integration app. Next.js 14 (Pages Router), TypeScript, deployed via Docker on a Synology NAS. Single page at `/` optimized for TV browser at 4K (dark theme only, 300% zoom).

### State management: URL is the single source of truth

All filter and display state lives in the URL query string. The `useAnimeUrlState` hook in [src/hooks/useAnimeUrlState.ts](src/hooks/useAnimeUrlState.ts) parses the URL into `filters` and `display` objects, and exposes updaters that call `router.push`. `applyPreset` replaces filter state while preserving persistent UI keys (layout, imageSize, etc.). Empty URLs are redirected to a default preset.

URL encoding/decoding and the preset logic (`VIEW_PRESETS`) live in [src/lib/animeUrlParams.ts](src/lib/animeUrlParams.ts).

`minScore`/`maxScore` filter MAL's `mean` score, NOT the user's personal score (`my_list_status.score`).

Adding a new filter dimension touches ~6 spots: `AnimeFiltersState` + `DEFAULT_FILTERS` + `PARAM_KEYS` + encode/decode in `animeUrlParams.ts`, the `filters` memo in `useAnimeUrlState.ts`, request-param building in `index.tsx`, the handler in `api/anime/animes/index.ts`, and the `AnimeListResponse.filters` echo type.

### Data storage: JSON files, no database

All data is stored as JSON files under `DATA_PATH` (env var, defaults to `/app/data`). Every slice file below is keyed by the **canonical id** (`a_<n>`, minted/resolved by the registry — see "Canonical-id store" below); the registry is the identity spine every other file hangs off:
- `animes_registry.json` — the identity spine: `Record<canonicalId, SourceIds>` (the crosswalk of provider ids — `mal`/`anilist`/`simkl`/…). Every write path resolves-before-mint against this file (`resolveCanonicalId(s)` in `store.ts`), so a rebuild never reattaches durable user data to the wrong title.
- `animes_mal.json` — raw MAL API data (`MALAnime`), keyed by canonical id
- `animes_hidden.json` — array of hidden **canonical ids**
- `animes_simkl.json` — SIMKL personal entries (`SimklPersonalEntry`), keyed by canonical id
- `animes_anilist_meta.json` — AniList catalog metadata (tags + staff + banner + catalog fields) keyed by canonical id (see "AniList tags + staff integration"). The code calls it `anilistMeta`.
- `animes_anilist_personal.json` — anonymously-imported AniList personal-list entries (`AniListPersonalEntry`), keyed by canonical id (see "AniList tags + staff integration" P3b).
- `animes_anilist_cast.json` — characters + Japanese seiyuu (`AniListCastEntry`), keyed by canonical id. **The one AniList slice that is NOT joined in `getAnimeForDisplay()`** — read only by the detail page, filled lazily per title (see "Cast" below).
- `animes_local_personal.json` — **in-app** personal state (`LocalPersonalEntry`: status/score/progress + `updated_at`), keyed by canonical id (see "Local personal-data provider").
- `mal_auth.json` — OAuth token + user data
- `mal_season_checkpoint.json` — set of historical seasons already crawled (keyed as `"YYYY-season"`). Named for what it is — the seasonal-crawl checkpoint — to sit unambiguously next to `simkl_sync_checkpoint.json`.
- `recommendations_feedback.json` — "Pour toi" thumbs, `{ canonicalId: 'up' | 'down' }` (see the "Pour toi" section)
- `recommendations.json` — cached recommendations feed data (crowd/AniList seeds + hydrated candidates); the code constant is `RECOMMENDATIONS_FILE`. Stays **MAL-id-keyed internally by design** — the reco engine's crowd-edge math is deliberately MAL-keyed (see "Canonical-id store" below), unlike every other file here.

[src/lib/jsonStore.ts](src/lib/jsonStore.ts) owns the raw file-I/O primitives (`DATA_PATH`, `dataFile`, `readJsonFile`, `writeJsonFile`); every module that persists a JSON file goes through it. `readJsonFile` carries a **parse cache keyed on the file's `mtimeMs + size`** (the big slices are ~40MB and ~26MB — parsing them dominated every cold path), and `writeJsonFile` evicts the entry. **Shared-reference contract:** callers may receive the same parsed object as other callers; mutate-then-write is safe (the write evicts), but never mutate a read result without writing it back — the mutation would leak into every later read.

[src/lib/store.ts](src/lib/store.ts) owns the **local record** — it reads those files and joins them into `AnimeRecord`, with an in-process row cache on `getAnimeForDisplay()` keyed on the **identity of the six parsed slices** (no TTL — the rows rebuild exactly when a slice file actually changed on disk, detected via the parse cache's mtime check). Write functions (`saveAnime`, `addHiddenAnimeId`, `removeHiddenAnimeId`, …) still set `cachedAnime = null` as a same-bundle belt-and-braces. **Naming rule:** functions here carry no source prefix, because they are about the local record rather than about MAL. A `MAL`/`Simkl`/`Anilist` prefix means the function genuinely concerns that one source's slice of the data.

The MAL pipe is split the way SIMKL's already was: [src/lib/mal.ts](src/lib/mal.ts) (OAuth token store + API reads, including the single `MAL_ANIME_FIELDS` field list every MAL read shares), [src/lib/malSync.ts](src/lib/malSync.ts) (big-sync + historical-crawl orchestration), [src/lib/malWrite.ts](src/lib/malWrite.ts) (writes back to MAL).

**Cross-bundle caches (context).** In a production Next build, **API routes and pages do NOT share module-level state** — each bundle holds its own parse cache and `cachedAnime`. This used to be a staleness trap; it no longer is, because **both caches invalidate off the file's mtime**: an API-route write bumps the mtime, and the page bundle's next read re-parses and rebuilds (live-verified on a standalone build: hide via API route → immediate `getServerSideProps` read reflects it). So pages may safely read `getAnimeForDisplay()`. The detail page ([src/pages/anime/[id].tsx](src/pages/anime/[id].tsx)) still reads its single record via `getAnimeByCanonicalId()` — kept because it's cheap (stat calls + one row assembly against cached parses) and fresh by construction.

### Canonical-id store: one record shape, no MAL id outward

The store is keyed by a **synthetic canonical id** (`a_<n>`), not the MAL id — the MAL id survives only as `crosswalk.mal` / `sources.mal.id`, used solely to call MAL's/SIMKL's APIs or link out. `AnimeRecord` ([src/models/anime/index.ts](src/models/anime/index.ts)) is the **one** local-record shape (no `extends MALAnime`, no `AnimeForDisplay` compat type — that transitional interface was retired in the provider-free cutover's Phase E):

```ts
interface AnimeRecord {
  id: string;                 // canonical id — the ONLY id, outward and internal (URLs, routes, React keys, hidden/feedback keys)
  crosswalk: SourceIds;       // { mal?, anilist?, simkl?, ... } — provider ids, for API calls / external links only
  catalog: AnimeCatalog;      // hydrated across providers (MAL-first by default)
  personal: AnimePersonal;    // hydrated across providers (SIMKL > MAL > AniList)
  sources: AnimeSources;      // raw per-provider slices: { mal?, simkl?, anilist?, anilistPersonal? }
  provenance: RecordProvenance; // per-field origin (which provider each catalog/personal field hydrated from)
  hidden?: boolean;
  discrepancy?: Discrepancy | null;
}
```

- **Hydration engine** ([src/lib/animeUtils.ts](src/lib/animeUtils.ts), `toAnimeRecord`): each provider exposes a partial extractor (`catalogFromMal`, `catalogFromAnilist`, `personalFromSimkl`, …); a generic precedence merge walks every field and takes the first source in precedence order with a defined value, recording the winner in `provenance`. Catalog precedence defaults MAL-first (`DEFAULT_CATALOG_PRECEDENCE`); personal precedence is SIMKL > MAL > AniList (`DEFAULT_PERSONAL_PRECEDENCE`).
- **`getEffectiveStatus`/`getEffectiveScore`/`getEffectiveProgress`** in `animeUtils.ts` are now thin reads of the already-hydrated `record.personal.*` — the SIMKL>MAL>AniList precedence itself lives in the hydration engine above, not in these three helpers. They're kept as the read seam: every personal read used for filtering, seeding, or exclusion still goes through them rather than reading `.sources.*` directly.
- **The reco engine is the one deliberately MAL-keyed exception.** `computeFeed`/`computeSimilarTo` in [src/lib/recommendations.ts](src/lib/recommendations.ts) build an internal `Map<number, AnimeRecord>` keyed by `crosswalk.mal` (coerced via `toNum`), because MAL/AniList crowd edges, suggestions, and `recommendations.json` all arrive as MAL ids. Only the *outward* edges of the engine (each `RecommendationItem`'s `.id`, hidden/feedback exclusion checks) are canonical — see docs/PROVIDER-FREE-CUTOVER.md "Risks".
- Legacy MAL-numeric-id URLs (bookmarks predating the cutover) resolve via `resolveByMalId()` and redirect to the canonical URL. `/rate?id=` is the one remaining genuinely-MAL-id-keyed route (`getAnimeByIdForDisplay()`), by design.

### CSS Modules with generated typings

**Components** use CSS Modules (`ComponentName.module.css`); **pages** use `<style jsx>` for their own one-off layout (`index.tsx`, `anime/[id].tsx`, `tier.tsx`, `recommendations.tsx` and `connections.tsx` all do). Follow whichever convention matches the file you are editing. Type definition files (`.module.css.d.ts`) are auto-generated by `typed-css-modules`. **Always run `npm run css:types` after modifying any `.module.css` file.** Classes use camelCase. Colors come from CSS custom properties defined in [src/styles/globals.css](src/styles/globals.css).

### Key data flow

1. `index.tsx` fetches `/api/anime/animes` with filter params derived from the URL state
2. API handler at [src/pages/api/anime/animes/index.ts](src/pages/api/anime/animes/index.ts) calls `getAnimeForDisplay()` then applies filtering/sorting via [src/lib/animeUtils.ts](src/lib/animeUtils.ts)
3. Results render in `AnimeTable` (table layout) or `AnimeCardView` (card layout), both inside `AnimePageLayout` with `AnimeSidebar`
4. Sidebar sections in [src/components/anime/sidebar/](src/components/anime/sidebar/) drive URL updates via callbacks passed down from `index.tsx`

### "Pour toi" recommendations — a dedicated page, NOT a view

The recommendation feed is a **computed candidate set + affinity ranking**, which is not expressible as a filter combination. It therefore lives on its own route [src/pages/recommendations.tsx](src/pages/recommendations.tsx) with its own URL state ([useRecommendationsUrlState](src/hooks/useRecommendationsUrlState.ts)) — it does **not** pollute `AnimeFiltersState`/`VIEW_PRESETS`. The page composes the existing sidebar section components (Account, Recommendations, RecoFilters, Display) directly rather than reusing the monolithic `AnimeSidebar`.

Ranking + fetch logic is in [src/lib/recommendations.ts](src/lib/recommendations.ts); endpoints under `src/pages/api/anime/recommendations/` (GET feed, POST refresh via SSE, POST/DELETE `feedback/[id]`). The *narrowing* filters that DO apply to the feed (media type, search, `mean` score range) go through the shared `applyNarrowingFilters` in [src/lib/animeUtils.ts](src/lib/animeUtils.ts) — the same function the main `/api/anime/animes` handler uses, so there is one filter implementation, not two. Status filter and sort do NOT apply (replaced by the hard "unseen" filter and affinity ranking).

**Scoring model (weighted sources).** `computeFeed` scores each candidate as an additive weighted sum `score = Σ weight · normalizedSourceValue`, where each source value is normalized to `[0,1]`. Sources: `crowd` (MAL crowd recos from seeds — the anchor), `suggestions` (MAL suggestions endpoint), `feedback` (affinity to the user's 👍 set — see below), `genre`/`studio`/`nsfw`/`rating`/`anilistTags`/`anilistStaff` (IDF-weighted taste-profile affinity — rare values carry more signal), plus `rejection` and `popularity` which default to **negative** weights. The candidate set stays anchored to crowd-edge targets + suggestions; the metadata sources only re-rank within it (they never inject new candidates). Each card carries a per-source `recoMeta.breakdown` powering the on-demand "Pourquoi ?" explain. Per-source weights are the tunable knobs, persisted in the URL as a single packed `w=crowd:1,studio:.8` param. **`DEFAULT_WEIGHTS`, the URL (de)serialization, and the UI metadata all live in the client-safe [src/lib/recoWeights.ts](src/lib/recoWeights.ts)** — never import them from `recommendations.ts` (it's `fs`-bound server-only). Sidebar sliders in `RecoWeightsSection` commit to the URL on release (not per-tick) to avoid history spam.

**Feedback (👍 "bonne pioche" / 👎 "pas pour moi").** Durable standalone store `recommendations_feedback.json` (`id → 'up'|'down'`) in `DATA_PATH`, decoupled from the transient feed. Thumbing a feed card files the verdict and removes it; **both** up and down ids are hard-excluded from the feed server-side in `computeFeed` (a 👍'd title isn't in the MAL list, so without this it would resurrect on reload). Two effects: (1) **re-rank** — the `feedback` source is an IDF-weighted genre+studio profile over the 👍 set (own tunable slider, shows in the explain as "Comme tes bonnes pioches …"); 👎 items fold into the existing `rejection` profile (hide + negative taste, no separate slider — an intentional 👍/👎 asymmetry). (2) **reshape** — at refresh, 👍 anime join the crowd **seeds** (synthetic `FEEDBACK_SEED_WEIGHT`, no MAL score) so their MAL crowd recos pull *new* candidates into the feed. The `dismissed` sub-view is replaced by two review-and-undo lists (`?rev=up` / `?rev=down`); the legacy pure-hide `recommendations_dismissed.json` is read-only and still excluded (superseded by 👎). URL key `rev`.

### MAL sync

- `/api/anime/mal/sync` — lightweight personal list sync (updates `my_list_status` on existing anime only, never inserts)
- `/api/anime/mal/big-sync` — full seasonal sync, fetches 8 years of seasons + upcoming ranking via MAL API, SSE progress streaming
- `/api/anime/mal/historical-crawl` — GET returns crawl stats; POST runs a 5-season batch crawl going back to 1960. Uses a module-level lock to prevent concurrent runs. Cron-sync also calls this directly from lib after triggering big-sync.
- `/api/anime/cron-sync` — cron-triggered, authenticated via `CRON_SECRET` header. Stays outside `mal/` on purpose: an external cron job on the NAS calls this exact path, and it spans MAL + recommendations. `/api/anime/auth` likewise stays put — it is the MAL OAuth app's registered redirect URI.
- `/api/anime/animes/[id]/refresh` (POST) — on-demand single-title refill from ALL THREE sources in parallel (MAL single-title GET merged over the local record, AniList force-refetch of tags+staff+banner, SIMKL incremental sync). Each source is isolated/non-fatal; returns a per-source `{ mal, anilist, simkl }` outcome. Backs the detail-page `RefreshButton`.

### SIMKL integration (read-only)

A second, read-only personal-data source alongside MAL. SIMKL data lives in a lean side-file `animes_simkl.json` (env `DATA_PATH`), **keyed by canonical id**, storing SIMKL-unique personal fields (`SimklPersonalEntry`: status normalized to MAL vocabulary, score, progress, watched date, the `simkl` id, and the full cross-source `ids` crosswalk). It is **joined onto the record in `getAnimeForDisplay()`** exactly like `animes_hidden.json`. MAL stays the **catalog** authority, but SIMKL is now the **personal-state** authority: see "Local cache authority" below.

- Sync is **one-way (SIMKL → app), personal library only** (statused anime), following SIMKL's two-phase model (`docs/simkl/apirules.md`): initial `/sync/all-items/anime` (plain — NOT `extended=ids_only`, which strips per-item status/rating/progress; the plain call already returns those plus full `ids` incl. `mal`, verified against a live account), then `/sync/activities` + `date_from` deltas, with `simkl_sync_checkpoint.json` holding the `anime.all` watermark. **Rating-only edits are a delta blind spot** (verified live 2026-07-06): a freshly-rated title does NOT appear in `all-items?date_from=…` even though its `activities.anime.rated_at`/`all` advanced — so the checkpoint also tracks `lastRatedAt`, and when it moves the sync falls back to a **FULL** `all-items` pull to capture the new score. Existing checkpoints predate `lastRatedAt` (undefined), so the first sync after this shipped does one backfilling full pull. Deletion reconciliation diffs `extended=simkl_ids_only` against the local store. Orchestration in [src/lib/simklSync.ts](src/lib/simklSync.ts); auth/state/watermark in [src/lib/simkl.ts](src/lib/simkl.ts); endpoints under `src/pages/api/anime/simkl/` (`auth`, `sync`). **Writes to SIMKL are limited to ONE narrow carve-out: user-initiated ratings** pushed from the Tier list board (see below). Nothing else is ever written to SIMKL — sync remains one-way SIMKL → app.
- **Discrepancy detection** is no longer SIMKL-specific — see "Local personal-data provider" below.
- Deferred: MAL-internal discrepancies, and wiring SIMKL delta into cron-sync. (Catalog-wide **tags** were originally planned as a SIMKL "big-sync" — superseded, see below: SIMKL's public API has no tags field or tag-filterable endpoint, verified against its live OpenAPI spec.)

### Local cache authority (personal-state precedence)

The architecture moved from "MAL-authoritative" to **local-cache-authority**: the merged local record is authority; MAL / SIMKL / AniList are interchangeable, absent-tolerant refill pipes. The user notes anime in SIMKL (SIMKL → MAL one-way), so **SIMKL is the authority for PERSONAL fields**, MAL the fallback.

- **The seam is three helpers in [src/lib/animeUtils.ts](src/lib/animeUtils.ts)** — `getEffectiveStatus` / `getEffectiveScore` / `getEffectiveProgress` (SIMKL-first, MAL fallback; `0`/`null` score = unrated). They are thin reads of the hydrated `record.personal.*` block — the actual SIMKL>MAL>AniList precedence lives in the hydration engine's `DEFAULT_PERSONAL_PRECEDENCE` (see "Canonical-id store" above), not in these three functions. **Every personal read used for filtering, seeding, or exclusion MUST go through them** — never read `sources.mal?.my_list_status` directly in those paths. This is atomic: a half-flip crashes the feed for a SIMKL-only completion that has no MAL `my_list_status` (`getSeeds` no longer guarantees one). Routed spots: status + `unrated` filters (`api/anime/animes`), and in `recommendations.ts` `getSeeds`, the seed live-weight, `seedW`, the rejection profile, and `isPrematureSequel`'s prequel lookup. Catalog fields (`mean`, genres, studios…) stay MAL-first — the helpers are personal-only. `computeDiscrepancy` deliberately still compares RAW per-provider slices (`sources.mal`/`sources.simkl`/`sources.local` — it detects mismatches, not the effective value).
- **Card display is intentionally NOT flipped**: the card keeps its explicit "MAL status" label (`sources.mal?.my_list_status`) and surfaces SIMKL state via the separate SIMKL badge/discrepancy. Display-through-effective is a conscious deferral.
- **Crosswalk-on-record, now load-bearing.** `record.crosswalk` (`SourceIds`) is assembled from every pipe: MAL self-id + SIMKL's rich `ids` block (mal, anilist, anidb, kitsu, tmdb, imdb…) captured at sync + AniList's own `idMal`-resolved id (authoritative over SIMKL's occasionally-mirrored `anilist`). Unlike its pre-cutover description, this is **not** merely informational: `animes_registry.json` persists exactly this crosswalk keyed by canonical id, and `resolveCanonicalId(s)` in `store.ts` reads/writes it on every sync to mint-or-resolve the canonical id — it is the identity spine the whole store hangs off (see "Canonical-id store" above). Existing SIMKL entries backfill `ids` on their next sync.

### Local personal-data provider (in-app rating, no external account)

A fourth personal source — the app's own — so the whole thing is usable with no MAL/SIMKL account, and so the write path generalizes to future providers (Betaseries, an AniList writer). Specs: `docs/localRating/`.

- **One predicate ties it together**: `hasWritableExternal()` in [src/lib/providers.ts](src/lib/providers.ts) — "is a writable external personal provider connected?", keyed on token **presence, not validity**. The local provider is enabled by default iff that's false, so an existing MAL/SIMKL user is unaffected (`local` is then absent from the precedence list entirely and a stray slice entry is never consulted). Settings expose `localProviderEnabled` / `localPrecedenceMode` (`auto` | `localTop` | `localBottom`); the pure math is `resolveLocalPrecedence` in `animeUtils.ts`. `providers.ts` is its own module to dodge the settings↔simkl import cycle.
- **Writes go through a registry**, [src/lib/personalWriters.ts](src/lib/personalWriters.ts): each `PersonalWriter` has `isEnabled` / `writeLocal` (sync) / `writeRemote` (async), and `writePersonal(canonicalId, patch)` runs **every** local-authority write before **any** remote push (structurally encoding local-cache-authority), then fans the remotes out serially (SIMKL's 20s write-lock). It returns `{ found, outcomes: Record<providerId, WriteOutcome> }` — both `rating.ts` and `mal-status.ts` are collapsed onto it. SIMKL's writer is score-only. `PersonalPatch.status = null` means **clear**, which no remote can express (MAL models it as a list DELETE), so remote writers report it unsupported and the UI only offers it when `hasWritableExternal()` is false.
- **The bootstrap surface** is [PersonalStateEditor](src/components/anime/PersonalStateEditor.tsx) on the detail page — the one control that takes an *unstatused catalog title* to statused + scored. It has to exist: the tier board only fetches already-statused titles and the reco feed needs completed+scored seeds, so a fresh local-only install renders empty everywhere else. No auto-complete on rating (that's `docs/quickRate/`'s idea, not this page's).
- **Discrepancy detection is N-provider**, [src/lib/discrepancy.ts](src/lib/discrepancy.ts) (client-safe/pure, the old `simklCompare.ts`): `computeDiscrepancy(states)` takes a `Partial<Record<ProvenanceSource, ProviderPersonalState>>` built from the RAW slices by `buildProviderStates` in `store.ts`, and reports a per-provider map + which dimensions `disagree`. Two rules worth knowing: differing progress where every present provider has watched all of **its own** total is not a disagreement (MAL 12/12 vs SIMKL 13/13); and **presence is deliberately asymmetric** — only "present somewhere, absent from MAL" flags (`PRESENCE_ANCHORS`), because MAL is the comprehensive list while SIMKL/local are subset feeds and a symmetric rule would flag the entire catalog. Surfaced by `DiscrepancyBadge`, the `discrepanciesOnly` (`disc`) URL filter, and the [discrepancies page](src/pages/discrepancies.tsx), which renders the **grouped long format** (one sub-row per provider under each anime) so a new provider costs a row, not a column.

### "/quick-rate" — franchise-bulk rating (docs/quickRate/)

A third rating surface, separable from localRating: one score fanned out over a whole **franchise**, and "just put a score, it counts as watched". Route `/quick-rate` with its own [useQuickRateUrlState](src/hooks/useQuickRateUrlState.ts), composing the sidebar sections like `/tier` does.

- **Franchise = connected component of the relation graph**, [src/lib/franchise.ts](src/lib/franchise.ts) (pure). Edges are undirected and restricted to sequel/prequel/side-story/parent — `alternative_version`/`other`/`spin_off` are excluded on purpose, because one bad merge sends a bulk score to the wrong show. Relation edges carry **MAL ids** while records are canonical-keyed, so traversal resolves through a MAL→canonical index built from `crosswalk.mal`.
- **The relation data comes from AniList, not MAL.** MAL returns `related_anime` only from its single-title *detail* endpoint — its list/seasonal endpoints omit it, so a crawled catalog has relations for almost nothing (46 of 25,370 when this shipped). `AniListMetaEntry.relations` (`AniListRelationEntry[]`, ANIME targets only — an `ADAPTATION` edge's `idMal` is the *manga's*) is fetched in the SAME batch query as tags/staff/banner and backfills on the `undefined` signal, so populating it is one "Sync AniList Metadata" run. MAL edges are still unioned in.
- **Scope is the whole catalog, unstatused titles included** — the one hard difference from the tier board (statused-only), because the unseen seasons of a franchise are exactly what you want to sweep. That volume is why [api/anime/quick-rate](src/pages/api/anime/quick-rate.ts) does the grouping AND a lean projection server-side (never ship 25k `AnimeRecord`s), and why **filtering refetches** instead of running client-side. The narrowing filters select *seeds*; each seed then expands to its whole franchise — **except media type, which also re-applies to members**, because it answers "what kind of entry do I rate at all" rather than "which franchise", and a TV-only watcher must not have "set all" score the franchise's movies. Component index is cached on the row-cache array's identity; output is **paginated** 20 groups per page (`page` query param, `p` URL key), since no filter combination narrows ~25k titles to one screenful and the old 60-group cap simply hid the remainder.
- **Rating auto-completes here and only here** (`{score, status:'completed', progress: numEpisodes}`, progress omitted when the episode count is unknown). Page-scoped and opt-out-able via the `ac` URL key — a deliberate score-only edit on the detail page or tier board is never hijacked. Writes reuse the tier board's serial queue over `PUT …/mal-status` → `writePersonal` (not score-only `rating`), optimistic with revert and per-provider failure badges.

### AniList tags + staff integration (read-only, no auth)

A third, read-only catalog-metadata source, added after confirming SIMKL's public API doesn't expose tags (only `genres`, which duplicates MAL). AniList's GraphQL API (`https://graphql.anilist.co`) is public/anonymous and exposes a rich tag taxonomy (`name`, `rank` 0-100 relevance, `category`) **and staff credits** (`role` + staff `id`/`name`) directly queryable by MAL id (`Media(idMal: Int, type: ANIME)`), so — unlike SIMKL — no id-resolution step is needed.

- Storage: `animes_anilist_meta.json` (`AniListMetaEntry`, keyed by canonical id), joined onto the record in `getAnimeForDisplay()` exactly like `animes_simkl.json`. Holds `tags`, `staff` (`AniListStaffEntry[]`, top-15 by relevance), `banner_image` AND `relations` (the franchise graph — see "/quick-rate" above). The latter two are optional so pre-existing entries stay valid — **a `undefined` field is the backfill signal**. `banner_image` is therefore written as an explicit `null` when AniList has none (common), so an absent banner never re-queues forever.
- Sync: [src/lib/anilistSync.ts](src/lib/anilistSync.ts)'s `performAnilistMetaSync()` fetches **tags + staff + bannerImage in one query per batch** (`Page(perPage:50){ media(idMal_in:$ids){ bannerImage tags … staff(sort:RELEVANCE, perPage:15){ edges{ role node } } } }` — verified live to stay under AniList's query-complexity ceiling; `bannerImage` is a scalar and costs nothing, but staff must stay nested in `Page.media`, NOT an aliased `Media`, which null-bombs on any miss). **Incremental**: fetches MAL ids with no entry OR an entry lacking `staff`/`banner_image` (so those backfill onto already-tagged titles). Gracefully skips MAL ids AniList doesn't have.
- `banner_image` is AniList's landscape key art — the one catalog field MAL has no equivalent of. The anime **detail page uses it as a full-page fixed backdrop** (crisp, at natural width, anchored top, masked into a blurred ambient fill of the same image + a grain layer). When it's null the page falls back to the portrait poster, which plays the ambient role only — a portrait cover-cropped to a wide viewport is a meaningless band, so it's blurred hard. All the tuning knobs are CSS vars on `.backdrop` in [src/pages/anime/[id].tsx](src/pages/anime/[id].tsx). The `.section` panels are deliberately translucent (incl. [MoreLikeThis.module.css](src/components/anime/MoreLikeThis.module.css), which carries its own copy of that style) so the backdrop reads through them. Throttled to ~28 req/min (AniList degraded limit 30/min, normally 90/min); retries once on `429` honoring `Retry-After`. Triggered via "Sync AniList Metadata" on the Connections page (`POST /api/anime/anilist/meta-sync`, fire-and-forget like `big-sync`); progress via `appendLog('anilist-meta-sync', …)` polled by the connection log panel, not SSE.
- Reco sources: `anilistTags` AND `anilistStaff` are `MetaField`s (these two keep the `Tags` name — they really are tag- and staff-specific, and `anilistTags` is persisted in the URL weights param) in [src/lib/recommendations.ts](src/lib/recommendations.ts), both following the exact `genre`/`studio` IDF-weighted-affinity pattern (tags = plain tag-name list; staff = stable AniList staff `id`, so a shared director/composer is a rare, strong signal; `role` feeds the "Pourquoi?" explain). Neither folds AniList's `rank` into scoring yet. Both ship at weight `0` by default in [src/lib/recoWeights.ts](src/lib/recoWeights.ts) until a sync has populated coverage.
- **AniList crowd recos** (`anilistCrowd` source): a SECOND crowd source alongside MAL's `crowd`, NOT a taste-profile source. `fetchAnilistRecommendations()` in [anilistSync.ts](src/lib/anilistSync.ts) queries the `Media.recommendations` connection for the same seed set (`Page(perPage:50){ media(idMal_in:$ids){ idMal recommendations(sort:RATING_DESC, perPage:15){ edges{ node{ rating mediaRecommendation{ idMal } } } } } }` — kept as its OWN query, not stacked on the tags+staff one, to stay under the complexity ceiling; verified live). `mediaRecommendation.idMal` resolves recs straight onto the MAL join key — no crosswalk (unlike SIMKL, whose `users_recommendations` carry only a `simkl` id, which is why SIMKL crowd recos were NOT adopted). Fetched during `performRecommendationsRefresh` (after MAL suggestions), stored in `RecommendationsData.anilistSeeds` (parallel to `seeds`, keyed by seed MAL id; `num` = AniList net `rating`), and hydrated through the same MAL detail path. In `computeFeed` it has its OWN accumulator + normalization denom (AniList `rating` ≠ MAL `num_recommendations`) and INJECTS new candidates like `crowd` does. Ships at weight `0` until a refresh populates it.

### Cast (characters + seiyuu) — a lazily-filled OFF-hot-path slice

The detail page's Cast section: each character paired with its Japanese voice
actor(s), from AniList. Storage is `animes_anilist_cast.json` (`AniListCastEntry`,
keyed by canonical id) — **its own slice, deliberately NOT part of the six-slice
join** in `getAnimeForDisplay()`, and the one AniList data set that works this way:

- **Why not on `AniListMetaEntry`.** Cast is display-only (it feeds no reco
  source, unlike `tags`/`staff`), and it's the bulkiest AniList payload there is
  (~25 characters × 2 portraits + 2 names per title — tens of MB catalog-wide,
  bigger than `animes_mal.json`). `animes_anilist_meta.json` is parsed on every
  cold row build and the row cache keys on those six slices' identity, so putting
  cast there would tax every row build for data one page reads. Hence
  `upsertAnilistCast` **does not clear `cachedAnime`** — a cast write cannot
  change any assembled row.
- **Filled lazily, one title at a time**, by `getOrFetchAnilistCast` in
  [src/lib/anilistCast.ts](src/lib/anilistCast.ts) (its own module — `anilistSync.ts`
  is for catalog-wide sweeps that feed hydration/recos). `getServerSideProps`
  reads the slice and passes `cast`; a `null` (never fetched) makes `CastSection`
  fetch `GET /api/anime/animes/[id]/cast` **once on mount**. It auto-fetches
  rather than click-to-load like `MoreLikeThis`, because it's one cheap request
  that happens at most once per title ever, and cast is core detail content.
- **An empty `characters: []` is persisted on purpose.** A MISSING entry means
  "never asked"; `[]` means "asked, AniList has none". Without storing the empty,
  a title AniList lacks would re-query on every page view. Relatedly, AniList
  answers an unknown id with a GraphQL **`404 Not Found` + `data.Media: null`**,
  which `fetchCast` treats as "no cast", NOT as an error.
- **Single-title query, so `Media(...)` is used directly** — the aliased-`Media`
  null-bomb caveat that forces `Page.media` in `anilistSync.ts` is a batching
  concern and doesn't apply. Takes `idMal` OR `id`, so AniList-only titles work.
- **Send ONLY the id you have — never the other one as an explicit `null`.**
  AniList applies a supplied-but-null argument as a real filter (`id = null`),
  matching nothing and answering 404; omitting the variable is what makes the
  argument absent. This is not a hypothetical: the original code sent
  `{malId, anilistId: null}` on every call, so every fetch 404'd, was read as
  "AniList has no cast", and persisted an empty `characters: []` — permanently,
  since empties short-circuit. Verified live 2026-07-19 and fixed.
- **Producers ride along on this query** (`studios { edges { isMain node } }`),
  and it is the app's ONLY producers source — MAL's API has no producers field,
  and the batched `TAGS_QUERY` already sits near the complexity ceiling, so this
  single-title query (which has headroom) carries them instead. `isMain: false`
  = producer. Consequence: `catalog.studios` is catalog-complete (MAL), while
  producers exist only for titles the cast sweep has reached.
- **`performAnilistCastSweep()` bulk-fills the STATUSED list** (~500-700 titles),
  behind the /stats page's button — never the ~25k catalog. It reuses the
  single-title path rather than batching `characters { voiceActors }` through
  `Page.media`, which is exactly the complexity gamble this file keeps warning
  about. **Resumable by construction**: each title persists as it lands and only
  missing ones re-queue, so an interrupted ~20-minute run loses nothing (verified
  live: cut at 69/665, restart queued 596). Fire-and-forget + `appendLog(
  'anilist-cast-sweep', …)`, same idiom as meta-sync/catalog-crawl.
- **Japanese VAs only** (`voiceActors(language: JAPANESE)`) — these are seiyuu, not
  dub actors. **All** of a character's VAs render, not just the first: dual casting
  (a child self + an adult inner monologue) and mid-series recasts are common.
- **Seiyuu link OUT to AniList, not to `/credits/staff/[id]`.** That page's
  `listAnimeByStaff` scans `sources.anilist.staff`, which is the top-15
  *production* credits — voice actors are never in it, so an internal link would
  resolve to nothing.

### AniList OAuth (login tier: write-back)

Above the anonymous read-by-username import sits an **OAuth'd** AniList tier
(`docs/ANILIST-OAUTH.md`) — a fourth writable personal provider. Auth lives in
[src/lib/anilistAuth.ts](src/lib/anilistAuth.ts) (token store `anilist_auth.json`
+ the authenticated GraphQL transport), the flow in
[src/pages/api/anime/anilist/auth.ts](src/pages/api/anime/anilist/auth.ts), and
writes in [src/lib/anilistWrite.ts](src/lib/anilistWrite.ts), registered as the
`anilist` entry in `personalWriters.ts`. Four things that differ from MAL/SIMKL:

- **No scopes, no refresh tokens, 1-year tokens.** There is no refresh path to
  write; on expiry the user re-authenticates. `isAnilistTokenValid` is a clock check.
- **The callback tolerates a missing `state`.** AniList isn't *documented* to
  round-trip it (though live-verification 2026-07-18 showed it does), so the
  callback keys on `code` alone and rejects only a state that came back *and* is
  stale/forged. Do NOT "fix" this into SIMKL's hard reject — the behaviour is
  undocumented and may change.
- **`SaveMediaListEntry(mediaId:)` takes the ANILIST id, not the MAL id** — the
  one write path that doesn't key off `crosswalk.mal`. `resolveAnilistMediaId`
  falls back to a live `Media(idMal:)` lookup when the crosswalk has no AniList id.
- **Always write `scoreRaw` (0-100 base), never `score`** — `score` is read in the
  user's own `scoreFormat`, so app-8 sent as `score` means 8/100 to a POINT_100
  user. `scoreRaw: score * 10` is correct for every profile.

Unlike SIMKL's score-only carve-out, this writer handles status + score +
progress (`SaveMediaListEntry` is an upsert). Note **AniList auto-fills
`progress` to the episode count when status becomes COMPLETED** (live-verified) —
so the app's own progress value is redundant on that path, not authoritative.
Clearing a status is refused (`ok: false` with a reason, never a silent drop),
same carve-out as MAL's writer. AniList still sits **last** in
personal precedence even when OAuth'd, and the authenticated *private-list read*
is not implemented yet — both are open items in the doc.

### "Plus comme ça" — the single-target drill-down (detail page)

The detail page's second reco block ([MoreLikeThis.tsx](src/components/anime/MoreLikeThis.tsx)), backed by `GET /api/anime/recommendations/similar/[id]` and `computeSimilarTo` in [recommendations.ts](src/lib/recommendations.ts). It flips the feed's question from "what fits my taste" to "what resembles THIS title", by running the **same weighted-source machinery** (`computeIdf` / `buildFieldProfile` / `fieldMatch` / `isPrematureSequel` / the additive `Σ weight · value` + `RecoContribution[]` breakdown) with **one anchor instead of the user's whole seed set**. Consequences, all deliberate:

- **The positive taste profiles are built from the target anime alone** (`buildFieldProfile([target], …)`), so a source scores "shares a *rare* genre/tag/studio/creator with this title". `suggestions` and `feedback` are user-global and have no per-title meaning, so `SIMILAR_WEIGHTS` forces them to `0`; `rejection` and `popularity` stay on (they hold for any candidate).
- **Candidate set = the target's crowd edges only** (MAL `fetchRecoEdges` ∪ AniList `fetchAnilistRecommendations`, fetched in parallel, each non-fatal with a per-source outcome in the response). Metadata only *re-ranks* within that set, never injects — which is exactly what keeps this block distinct from the sibling **"Dans le même studio / staff"** block ([similarByCredits.ts](src/lib/similarByCredits.ts)), a pure catalog-wide credit similarity computed in `getServerSideProps`.
- **Seen titles are NOT excluded** (unlike `computeFeed`). The pool is ≤ ~25 edges before filtering, so hard-dropping seen titles guts the block for a heavy watcher; they're returned with their effective `status` and marked "👁 Déjà vu". Still excluded: the target + its `related_anime`, hidden, 👎, premature sequels.
- **Stateless and hydration-free.** It never reads or writes `RecommendationsData`, and a crowd edge pointing at a title absent from the local catalog is simply skipped (no metadata to rank on) rather than triggering a MAL detail fetch.
- **Click-to-load**, because the detail page otherwise makes zero external calls and this block costs a MAL + an AniList round-trip.

### Tier list rating board — a dedicated page that WRITES scores

A drag-and-drop rating surface at [src/pages/tier.tsx](src/pages/tier.tsx) (route `/tier`; note `/rate` is the unrelated Rating Calculator). Like `/recommendations` it's its own route with its own lean URL state ([useTierUrlState](src/hooks/useTierUrlState.ts)), **not** a third layout of the main list — it has editing semantics the main `AnimeFiltersState` shouldn't carry. It composes `RecoFiltersSection` + an inline thumbnail-size control in the sidebar.

- **A tier IS a score.** Ten rows (10→1, colored green→red with MAL's word labels) plus an "à noter" tray (unrated). Dropping a card into a row sets that MAL/personal score; dropping into the tray clears it (score 0).
- **Scope = the personal list, not the catalog.** Fetches `?status=watching,completed,on_hold,dropped&limit=all` (≈500 titles) — `plan_to_watch` is excluded (you can't rate what you haven't seen), which also means every card is already statused, so score writes never touch status. Splitting the *whole crawled catalog* (back to 1960) by score would be wrong. Cards are bucketed client-side by `getEffectiveScore`; all narrowing filters run client-side (via `applyNarrowingFilters`) so filtering never refetches.
- **Writes fan out to EVERY enabled provider**, not just MAL+SIMKL. The endpoint `POST /api/anime/animes/[id]/rating` ([rating.ts](src/pages/api/anime/animes/[id]/rating.ts)) is now a thin wrapper over `writePersonal` (see "Local personal-data provider" above), so it is the registry — not this route — that decides who gets written: every local-authority slice first (local-cache-authority; SIMKL-first `getEffectiveScore` means the local SIMKL bump is required for the drag to show through), then the enabled remotes serially. Since AniList OAuth landed that includes AniList. The original "both MAL and SIMKL" intent (keep them in sync, avoid a spurious discrepancy badge) is preserved as a *consequence* of fanning out to all writers, not as a hardcoded pair.
- **Remote-write failures are surfaced, not silent.** The endpoint returns the registry's per-provider `outcomes` map; the board shows a red badge on the card when a source didn't take. This matters because a SIMKL-first effective score would otherwise *hide* a failed SIMKL push (local MAL + local SIMKL already show the new value, so no discrepancy, and no sync corrects it). Both [tier.tsx](src/pages/tier.tsx) and `PersonalStateEditor` **iterate the outcomes map** rather than naming providers — hardcoding `mal`/`simkl` is what silently swallowed AniList failures once OAuth write-back shipped. `local` needs no filtering: its `writeRemote` is a no-op that always reports `ok`.
- **SIMKL ratings bucket = `shows` for anime** (live-verified 2026-07-05: a TV anime rating returned `201 added.shows:1`, empty `not_found`, `type:"show"` — score-only, status untouched). `pushSimklRating` still tries a bucket by `media_type` and self-corrects on `not_found` (kept as a safety net — anime *movies* under `media_type=movie` try `movies` first and are not yet live-verified). Every write is logged (`[simkl-rating]`).
- **Client write queue is serial** (`await` each before the next) — sidesteps SIMKL's 20s per-user write-lock and 1 req/s POST cap without batching. Optimistic move with revert-on-failure. Drag/drop is native HTML5 (zero-dep; score is the only persisted state, so within-row order doesn't matter). One shared hover-zoom preview element shows the large poster (not 500 large `<img>`s).

### "/stats" — repartition of the statused list

A read-only analysis surface at [src/pages/stats.tsx](src/pages/stats.tsx), its own
route with its own lean URL state ([useStatsUrlState](src/hooks/useStatsUrlState.ts):
just `st` statuses + `dim` dimension). Six dimensions, each a top-50 ranked by
share desc: studios, seiyuu (with portraits), technical staff, producers, tags,
genres.

- **Scope is the STATUSED list** (`getEffectiveStatus` defined), not the ~25k
  crawled catalog — a repartition over never-watched titles would describe MAL's
  catalog rather than the user's taste. Unlike the tier board, `plan_to_watch` IS
  offered (asking what your backlog is made of is legitimate; you just can't rate it).
- **Aggregation counts DISTINCT anime, never credits** — a seiyuu voicing three
  characters in one show counts once. Multi-valued dimensions sum past 100% on
  purpose (a title has many genres); the percentage reads "X% of your list
  features this", denominator = filtered title count.
- **Computed server-side** ([api/anime/stats.ts](src/pages/api/anime/stats.ts) over
  the pure [src/lib/stats.ts](src/lib/stats.ts)), same reasoning as `/quick-rate`:
  shipping ~600 records PLUS their cast entries to rank them in the browser would
  be tens of megabytes for a few kilobytes of output. The cast slice is read
  separately — it is deliberately not in `getAnimeForDisplay()`'s join.
- **Four dimensions are free off the record** (studios/genres from `catalog`,
  tags/staff from `sources.anilist`); **seiyuu and producers are not** — both come
  from the lazily-filled cast slice, so every dimension reports its own `covered`
  count and the two cast-backed ones offer the sweep button when titles are missing.
- Staff rows link to `/credits/staff/[id]`; **seiyuu rows deliberately do not** —
  that page scans production credits, which never contain voice actors (see the
  Cast section above).

### First-run onboarding (empty store)

When the store is **genuinely empty**, `index.tsx` renders [FirstRunOnboarding](src/components/anime/FirstRunOnboarding.tsx) instead of the list: the resolved data folder (from `GET /api/anime/settings`), a link to `/settings`, and a button that seeds the catalog from AniList with a live progress bar.

- **The gate is the registry count**, not the filtered list length: a mount-time `GET /api/anime/anilist/catalog-crawl` returns `totalCanonicalIds` (0 = empty) — so a filter combination that hides everything never false-positives into onboarding. The same response's `crawlRunning` lets a mid-crawl page reload resume the progress view.
- **The button fires the bulk crawl** — `POST /api/anime/anilist/catalog-crawl` with `{scope: 'bulk'}` → `performAnilistBulkCatalogCrawl` in [anilistSync.ts](src/lib/anilistSync.ts): seasons newest-first from the NEXT season back 8 years (~36 seasons × ≤3 pages × 50 titles, mirroring MAL big-sync's window), **persisting after every season** (a mid-crawl failure keeps everything already fetched; one bad season is non-fatal and logged at `info` level — an `error`-level entry is the onboarding's fatal signal). Shares the run lock and the `anilist-catalog-crawl` log channel with the single-season crawl (which stays wired to the Connections page).
- **Progress = polling `GET /api/anime/connection-log`** for the per-season entries' `{seasonIndex, totalSeasons}` detail (no SSE — same pattern as the connections log panel). The panel snapshots the log head id before starting so stale entries from an earlier crawl (LOGS_PATH survives a data reset) are never misread as ours. On the `success` entry it flips back to the list; newest-first crawling means the default preset (current-season TV) has rows immediately.

A lightweight, dependency-free i18n built for GitHub visibility (the app is single-user, so path-based locale routing / SEO buy nothing and would fight the "URL is source of truth" + single-page architecture). Lives in [src/lib/i18n.tsx](src/lib/i18n.tsx); strings in [src/locales/fr.json](src/locales/fr.json) + [src/locales/en.json](src/locales/en.json) (flat dotted keys).

- **`fr` is the canonical key set.** `TranslationKey = keyof typeof fr`, and `DICTS` is typed `Record<Lang, Record<TranslationKey, string>>` so a key present in `fr.json` but missing from `en.json` is a **compile error**. A contributor adds a language by copying a JSON file and registering it in `DICTS`.
- **Active language lives in `localStorage`** (`anime-app.lang`), not the URL. To stay hydration-safe, the **server and first client render always use `DEFAULT_LANG` (`fr`)**; `I18nProvider`'s mount effect then reads `localStorage` and swaps. So EN only ever appears after client hydration — SSR HTML is always FR. `LanguageToggle` (in [Layout.tsx](src/components/Layout.tsx)) flips + persists.
- **Client usage:** `useT()` → `t(key, params?)`; `{name}` placeholders interpolate via the `params` object. **Dynamic keys** built from stable data ids use a cast: `` t(`statusShort.${status}` as TranslationKey) `` — the cast **bypasses the missing-key compile check**, so those families (`airing.*`, `seasonName.*`, `status.*`/`statusShort.*`, `field.*`, `reco.source.*`, `reco.preset.*`, `views.*`, `tierWord.*`) must be kept exhaustive by hand. The shared data files (`recoWeights.ts` `SOURCE_META`, `animeUrlParams.ts` `VIEW_PRESETS`) are **not** translated — keys are derived from their stable `source`/`key` fields in the rendering components, keeping those modules server-safe.
- **Server usage:** `translate(lang, key, params?)` / `makeT(lang)` are framework-free (no React context) for the reco **"Pourquoi ?"** detail strings built in [recommendations.ts](src/lib/recommendations.ts) (`computeFeed` / `computeSimilarTo` take a `lang`, keyed `recoDetail.*`). The client passes `?lang=` to `/api/anime/recommendations` and `…/similar/[id]`; both default to `fr`.
- **Deliberately left French-only:** the `/rate` rubric ([ratingGrids.ts](src/lib/ratingGrids.ts), subjective prose) — only the calculator's chrome is translated. `formatUserStatus` is still used for the catalog `source` field (language-neutral prettify), not for watch statuses.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATA_PATH` | Root for JSON data files (default: `/app/data`) |
| `LOGS_PATH` | Logs directory |
| `MAL_CLIENT_ID` | MyAnimeList OAuth app client ID |
| `MAL_REDIRECT_URI` | OAuth redirect URI |
| `CRON_SECRET` | Auth token for cron-sync endpoint |
| `SIMKL_CLIENT_ID` | SIMKL OAuth app client ID (required query param on every SIMKL request) |
| `SIMKL_CLIENT_SECRET` | SIMKL OAuth token exchange (confidential client) |
| `SIMKL_APP_NAME` | Sent as `app-name` query param + `User-Agent` on SIMKL requests |
| `SIMKL_REDIRECT_URI` | SIMKL OAuth redirect URI |
| `ANILIST_CLIENT_ID` | AniList OAuth app client ID (login tier only — the catalog/tags sync needs no key) |
| `ANILIST_CLIENT_SECRET` | AniList OAuth token exchange |
| `ANILIST_REDIRECT_URI` | AniList OAuth redirect URI |

### Pages importing from `@/lib/store`

[src/lib/store.ts](src/lib/store.ts) uses Node.js `fs`/`path` (via `jsonStore.ts`) and must never be bundled client-side. Only **pages** (`getServerSideProps`, API routes) import it, and always as values, since they run server-side. Client **components** never need it — they get their types (`AnimeRecord`, `UserAnimeStatus`, etc.) from [@/models/anime](src/models/anime/index.ts), which has no `fs` dependency and is safe to import as values from either side.

### Import aliases

```typescript
import { ... } from '@/components/anime';
import { ... } from '@/models/anime';
import { ... } from '@/components/shared';
import { ... } from '@/lib/animeUrlParams';
```

### Docker deployment

Multi-stage build, `next build --output standalone`, port `12344:3000`. Volume mounts for `/app/data` and `/app/logs`. See [Dockerfile](Dockerfile) and [docker-compose.yml](docker-compose.yml).

### Browser API constraints (production)
The NAS serves the app over HTTP (not HTTPS). Secure-context-only APIs (`navigator.clipboard`, etc.) are unavailable in production but work on localhost. Always provide a `document.execCommand` fallback for clipboard operations.
