# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server + CSS type watcher (concurrently)
npm run build        # prebuild (CSS types, lint, tests), then next build
npm run lint         # ESLint CLI (`eslint .`) — `next lint` was removed in Next 16
npm test             # node:test over tests/**/*.test.ts (also runs in prebuild)
npm run css:types    # Regenerate CSS Module typings (run after any .module.css change)
npm run data:copy    # Pull the live NAS store into the local DATA_PATH (office machine)
npm run data:copy-salon   # Same pull, salon machine
npm run screenshots  # Playwright capture into docs/screenshots
```

**The test suite pins ⚠️ invariants, and nothing else.** `npm test` is `node:test` over `tests/**/*.test.ts`, run through `scripts/lib/ts-loader.js` — the same loader the measurement scripts use, so there is no second TypeScript pipeline to configure and no test framework in `package.json`. It is wired into `prebuild`, so a broken invariant fails `npm run build` exactly the way the eslint `files` blocks fail it for a client-safety or MCP-write violation. That is what the suite is FOR: this file carries a great deal of ⚠️ "do NOT undo this", and a prose warning is enforced by whoever reads it while a test is enforced by the build. ⚠️ **`node --test` exits 0 when its glob matches nothing**, so `pretest` runs [scripts/check-suite-discovered.js](scripts/check-suite-discovered.js), which fails the build when `tests/` is absent or empty — without it, renaming the folder or switching to a `.spec.ts` convention would leave `prebuild` green while enforcing nothing, which is the same silent failure one level up.

**It is not a coverage effort, and the exclusions are deliberate.** No component tests, no E2E, no mocked providers, and above all **no snapshots of feed or ranking output** — the ranking is meant to change, so a snapshot would turn every tuning run red. The bugs this project actually has (the aliased-`Media` null bomb, `scoreRaw` over `score`, SIMKL's contaminated foreign keys, the cron secret) are live-provider and config failures that no unit test reaches; those are still verified by `npm run build` plus a live check against a real store pulled with `data:copy*`. A ranking change is still justified by `scripts/backtest-reco.js`, which **measures rather than asserts** — do NOT convert it into pass/fail, it has no ground truth to assert against.

**A test earns its place by pinning something that fails SILENTLY.** [tests/domain/genreAxis.test.ts](tests/domain/genreAxis.test.ts) is the model: skip the alias before the whitelist check and `Suspense` is misfiled as a theme on 1,000+ titles, with no crash, no build error and nothing visibly wrong on screen. A test that merely restates what the types already guarantee is noise. Tests needing a store on disk are a harder, separate thing — `DATA_PATH` is a module-init const in `jsonStore.ts` and `readJsonFile`'s parse cache is module-level, so a fixture must be written through `writeJsonFile` (which evicts) and `DATA_PATH` set before the module is imported. The suite stays on pure functions until that is worth solving.

**What is covered today**, so a ⚠️ below can be traced to the test holding it: `genreAxis` (the alias before the whitelist), `staffRole` (the three qualifier rules, and each of the two trims the lookup depends on), `url/animeParams` (the encode/decode round-trip, driven off a `AnimeFiltersState`-typed sample so a new filter is a compile error there), `providers/discrepancy` (the progress exception and the asymmetric presence rule), `reco/scoring` (`popularityScale` spanning [0,1], `fieldMatch`'s divide-by-value-count, the discriminative netting), `mcp/tools`' `projectWhy` (the per-sign trim), and the two i18n files above. **Every one of them was verified by breaking the thing it guards** — if you add a test here, do that too: a test that has never failed has proved nothing.

**Pick the `data:copy*` variant by destination, not by guessing.** The two scripts are identical apart from the target — office is `E:\Workspace\local\AnimeTracker\data`, salon is `D:\Workspaces\local\AnimeTracker\data`. Whichever of the two already exists is the machine you're on. Run it before measuring anything against real store data; both mirror with `/PURGE`, which the layout guard depends on (a half-migrated store makes the first read throw).

`scripts/` also holds one-shot store migrations (`migrate-canonical`, `migrate-layout`, `migrate-mal-personal`, `migrate-registry` — the last exposed as `npm run registry:migrate`). The thrown message names the script to run.

**`scripts/lib/ts-loader.js` lets a plain `node scripts/*.js` import the app's own TypeScript**, so a measurement script exercises the REAL engine instead of a JS re-implementation that would drift from it. It registers a `module.registerHooks()` pair — ⚠️ **which is why this repo needs node >= 22.15** (`engines` declares it, and `.github/workflows/ci.yml` pins the runner to 22): on node 20 the loader dies with `registerHooks is not a function`, and since `prebuild` runs the test suite through it, that takes the whole build down. The CI runner was on 20 and green until the suite was wired in, because nothing in a build had ever loaded this file. The pair is: one resolving the `@/` alias and the omitted extensions `moduleResolution: bundler` allows, one running each file through `ts.transpileModule`. ⚠️ The transpile is not decoration — node's built-in type stripping cannot tell a type from a value, so `feed.ts`'s opening `import { AnimeRecord, … } from '@/models/anime'` (all interfaces, imported as values) would fail to link; TS elides exactly the imports never used in a value position. It also hands back bare `.json` imports as modules, since `src/locales/*.json` is imported without the attribute node's ESM loader demands.

**`node scripts/backtest-reco.js --cutoff YYYY-MM-DD` is how a ranking change gets justified** — see "Measuring a ranking change" below.

## Project posture — a single-user hobby app

One person's anime tracker, running on their own NAS, for themselves. No other users, no SLA, no migration window, no support burden. That changes which trade-offs are correct: **pick the design you'd want if the store were empty, then pay whatever one-time cost gets you there.**

**"That would require re-syncing / re-crawling / rewriting the store" is a line in the plan, not a reason to pick the other option.** Specifically, these are cheap and must never block a better design:

- **Reprocessing data** — re-parsing, re-keying or rewriting any slice, the ~40 MB catalog included.
- **Reshaping the store** — new file, new folder, renamed field, different key. Write the one-shot script in `scripts/`, run it, move on. Don't design a compat shim, a version field or a dual-read path for a store with exactly one copy in the world. The MAL catalog/personal split (H1) is the precedent: a migration paid to get a better shape.
- **Long sweeps** — the cast sweep is ~20 minutes, the bulk crawl longer. They're resumable and fire-and-forget; nobody is waiting on them.
- **Dropping anything a provider can re-supply** — catalog, tags, staff, cast, relations, banners, recos. Delete-and-repull is a legitimate fix.
- **Breaking old URLs, removing unused features, deleting dead paths** — there is one user, and they can be told.

**The costs that are real**, and the only ones worth designing around:

- **Durable user data** — `personal/local.json`, `user/hidden.json`, `user/reco_feedback.json`, and any score/status that lives only here. Not refetchable; resolve-before-mint in the registry exists for exactly this. `npm run data:copy*` before anything destructive, and **ask before an operation that can lose it** (spending CPU time needs no permission).
- **Someone else's API** — AniList's ~30 req/min, SIMKL's 20s write lock + 1 req/s, MAL's limits. Wall-clock time is free; hammering a free public API is not.
- **Hot-path latency** — work paid on *every* row build, request or page load. Several notes below are justified by cost (the cast slice off the seven-slice join, the parse/row caches, the MAL personal/catalog split). Those are this category, not migration cost — don't generalize them into a rule against restructuring, and don't read this section as licensing their removal.

**This changes the cost calculus, not the facts.** Live-verified provider behaviour and every "do NOT undo this" note below (the aliased-`Media` null bomb, `scoreRaw` over `score`, AniList's supplied-but-null filter, the `prebuild` lint/test wiring, the pinned holdbacks) stay absolute. Hobby ≠ sloppy either: still run `npm run css:types` after a `.module.css` edit, still build before declaring done, and never leave the store half-migrated — the layout guard turns that into a hard throw on the first read.

## Architecture

**Anime Tracker** — a MyAnimeList integration app. Next.js 14 (Pages Router), TypeScript, deployed via Docker on a Synology NAS. Single page at `/` optimized for TV browser at 4K (dark theme only, 300% zoom).

### State management: URL is the single source of truth

All filter and display state lives in the URL query string. The `useAnimeUrlState` hook in [src/hooks/useAnimeUrlState.ts](src/hooks/useAnimeUrlState.ts) parses the URL into `filters` and `display` objects, and exposes updaters that call `router.push`. `applyPreset` replaces filter state while preserving persistent UI keys (layout, imageSize, etc.). Empty URLs are redirected to a default preset.

URL encoding/decoding and the preset logic (`VIEW_PRESETS`) live in [src/lib/url/animeParams.ts](src/lib/url/animeParams.ts).

`minScore`/`maxScore` filter MAL's `mean` score, NOT the user's personal score (`my_list_status.score`).

Adding a new filter dimension touches ~6 spots: `AnimeFiltersState` + `DEFAULT_FILTERS` + `PARAM_KEYS` + encode/decode in `url/animeParams.ts`, the `filters` memo in `useAnimeUrlState.ts`, request-param building in `index.tsx`, the handler in `api/anime/animes/index.ts`, and the `AnimeListResponse.filters` echo type.

### Data storage: JSON files, no database

All data is stored as JSON files under `DATA_PATH` (env var, defaults to `/app/data`), **organized into role folders** rather than filename prefixes (docs/DATA-LAYOUT.md — `mal_auth.json` became `auth/mal.json`, `animes_mal.json` became `catalog/mal.json`, and so on). The role is the folder; the basename is the provider, so the same basename under `catalog/` and `personal/` is the point, not a collision. Every anime slice file below is keyed by the **canonical id** (`a_<n>`, minted/resolved by the registry — see "Canonical-id store" below); the registry is the identity spine every other file hangs off:

Two files sit at the root, for reasons: `settings.json` (tier-1 config, read before the store exists — filing it under a data folder would invert the dependency) and `registry.json` (the spine the roles hang off; it belongs to no role).

**`personal/` holds exactly one file per `ProvenanceSource`** — the same set personal precedence ranges over, `personalWriters` registers, and `buildProviderStates` iterates. That is the folder's whole point: a missing file is a visible bug rather than something to remember, and adding a provider is "add a file, add a `ProvenanceSource`" with no third place to update.
- `registry.json` — the identity spine: `Record<canonicalId, SourceIds>` (the crosswalk of provider ids — `mal`/`anilist`/`simkl`/…). Every write path resolves-before-mint against this file (`resolveCanonicalId(s)` in [store/registry.ts](src/lib/store/registry.ts)), so a rebuild never reattaches durable user data to the wrong title.
- `catalog/mal.json` — raw MAL API data (`MALAnime`), keyed by canonical id. **Pure catalog** since the H1 split — it no longer carries `my_list_status` (see below).
- `personal/mal.json` — MAL personal-list entries (`MALPersonalEntry`), keyed by canonical id. Split out of the MAL catalog slice (docs/DECISIONS.md, H1) so MAL is a personal slice like the other three, and a rating write no longer rewrites the 39 MB catalog. Filled by split-on-ingest (`upsertAnime` strips the inline `my_list_status` off every MAL fetch and routes it here) and by the personal-list sync.
- `user/hidden.json` — array of hidden **canonical ids**
- `personal/simkl.json` — SIMKL personal entries (`SimklPersonalEntry`), keyed by canonical id
- `catalog/anilist.json` — AniList catalog metadata (tags + staff + banner + catalog fields) keyed by canonical id (see "AniList tags + staff integration"). The code calls it `anilistMeta`.
- `personal/anilist.json` — AniList personal-list entries (`AniListPersonalEntry`) imported from the **OAuth'd viewer's own list**, keyed by canonical id (see "AniList OAuth" below). An entry here always belongs to a connected account — there is no anonymous import path.
- `catalog/anilist_cast.json` — characters + Japanese seiyuu (`AniListCastEntry`), keyed by canonical id. **NOT joined in `getAnimeForDisplay()`** — read only by the detail page, filled lazily per title (see "Cast" below).
- `catalog/anilist_seiyuu.json` — one seiyuu's ANIME credits as AniList reports them (`AniListSeiyuuEntry`), **keyed by AniList staff id — the one slice here not keyed by canonical id**, because a filmography belongs to a person rather than a title. Also off the row join, also filled lazily, one person at a time (see "Seiyuu filmography" below).
- `personal/local.json` — **in-app** personal state (`LocalPersonalEntry`: status/score/progress + `updated_at`), keyed by canonical id (see "Local personal-data provider").
- `auth/mal.json` — MAL OAuth token + user data (its peers: `auth/simkl.json`, `auth/anilist.json`, and the three transient `auth/oauth_state_*.json` CSRF files)
- `sync/mal_seasons.json` — set of historical seasons already crawled (keyed as `"YYYY-season"`) — the seasonal-crawl checkpoint, sitting next to `sync/simkl_checkpoint.json` (all-items watermark + `lastRatedAt`), `sync/anilist_import.json` and `sync/anilist_years.json` (AniList's back-catalog checkpoint, `{ syncedYears: number[] }` — a year is never re-crawled, so re-running the window means deleting the file).
- `sync/cron_health.json` — the cron watermark: last scheduled arrival, last scheduled run, last MANUAL run (recorded but never counted), last rejection. Feeds the `/connections` freshness indicator; see "Scheduled sync". Rebuildable in the sense that a deleted file simply reports `unknown` until the next tick.
- `user/reco_feedback.json` — "Pour toi" thumbs, `{ canonicalId: 'up' | 'down' }` (see the "Pour toi" section)
- `user/boxes.json` — « Mes boîtes »: hand-drawn taste axes, a bare `Box[]` whose `members` are canonical ids (see the "/boxes" section)
- `cache/recommendations.json` — cached recommendations feed data (the one **rebuildable** file: `cache/` says so) (crowd/AniList seeds + hydrated candidates); the code constant is `RECOMMENDATIONS_FILE`. **Canonical-id-keyed like every other file here** since E10 (docs/DECISIONS.md), and carrying a `v` (`RECO_CACHE_VERSION`): an older MAL-keyed file parses fine but would miss every lookup and render an empty feed silently, so a version mismatch **discards** it rather than migrating — it is `cache/`, the next refresh rebuilds it.
- `logs/connection_log.json` — the sync-progress feed. Named like diagnostics, but it is **app data**: the Connections panel and the first-run onboarding bar *poll* it (there is no SSE for meta-sync, the cast sweep or the catalog crawl — this log IS the transport). So it lives in the store under `DATA_PATH`, **not** under `LOGS_PATH`, which consequently has no writer left and stays reserved for real debug output.

[src/lib/store/jsonStore.ts](src/lib/store/jsonStore.ts) owns the raw file-I/O primitives (`DATA_PATH`, `dataFile`, `readJsonFile`, `writeJsonFile`); every module that persists a JSON file goes through it. `dataFile('personal/mal.json')` is the single seam the folder layout goes through, so `ensureDataDirectory` creates the file's **own parent**, not just `DATA_PATH` — otherwise the first write on a fresh install `ENOENT`s. A pre-layout store (flat `animes_*.json`, no `catalog/`) makes the first read **throw** rather than fall through to first-run onboarding on top of a full store; the flag latches only once the check passes, never before the throw, so every read fails consistently. `readJsonFile` carries a **parse cache keyed on the file's `mtimeMs + size`** (the big slices are ~40MB and ~26MB — parsing them dominated every cold path), and `writeJsonFile` evicts the entry. **Shared-reference contract:** callers may receive the same parsed object as other callers; mutate-then-write is safe (the write evicts), but never mutate a read result without writing it back — the mutation would leak into every later read.

`src/lib/store/` owns the **local record**. It is four modules plus a barrel, stacked bottom-up (docs/DECISIONS.md) — [registry.ts](src/lib/store/registry.ts) the identity spine (mint-or-resolve canonical ids, depends on nothing but `jsonStore`), [slices.ts](src/lib/store/slices.ts) one read/write block per JSON file with ids resolved on the way in, [record.ts](src/lib/store/record.ts) the join that turns the seven slices into `AnimeRecord[]`, and [recordCache.ts](src/lib/store/recordCache.ts). **`index.ts` is a barrel** re-exporting all 39 symbols, so the ~25 `@/lib/store` importers neither know nor care about the split; import the leaf module directly only inside `store/` itself.

The row cache on `getAnimeForDisplay()` is keyed on the **identity of the seven parsed slices** (no TTL — the rows rebuild exactly when a slice file actually changed on disk, detected via the parse cache's mtime check). Write functions (`saveAnime`, `addHiddenAnimeId`, `removeHiddenAnimeId`, …) still call `invalidateRecordCache()` as a same-bundle belt-and-braces. **That cache lives in its own two-variable module for a structural reason**: `record.ts` imports every slice reader, so if the cache lived there the slice writers would have to import back from it and the two files would be mutually recursive. **Naming rule:** functions here carry no source prefix, because they are about the local record rather than about MAL. A `MAL`/`Simkl`/`Anilist` prefix means the function genuinely concerns that one source's slice of the data. One deliberate exception to the layering: `getMalIdForCanonical` is a crosswalk read but sits in `slices.ts`, not `registry.ts`, because it consults the MAL catalog slice first — and the registry must stay *below* the slices so slice writes can resolve ids without a cycle.

The MAL pipe is split the way SIMKL's already was: [src/lib/providers/mal/client.ts](src/lib/providers/mal/client.ts) (OAuth token store + API reads, including the single `MAL_ANIME_FIELDS` field list every MAL read shares), [src/lib/providers/mal/sync.ts](src/lib/providers/mal/sync.ts) (big-sync + historical-crawl orchestration), [src/lib/providers/mal/write.ts](src/lib/providers/mal/write.ts) (writes back to MAL).

**Cross-bundle caches (context).** In a production Next build, **API routes and pages do NOT share module-level state** — each bundle holds its own parse cache and row cache. This used to be a staleness trap; it no longer is, because **both caches invalidate off the file's mtime**: an API-route write bumps the mtime, and the page bundle's next read re-parses and rebuilds (live-verified on a standalone build: hide via API route → immediate `getServerSideProps` read reflects it). So pages may safely read `getAnimeForDisplay()`. The detail page ([src/pages/anime/[id].tsx](src/pages/anime/[id].tsx)) still reads its single record via `getAnimeByCanonicalId()` — kept because it's cheap (stat calls + one row assembly against cached parses) and fresh by construction.

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

- **Hydration engine** ([src/lib/domain/animeUtils.ts](src/lib/domain/animeUtils.ts), `toAnimeRecord`): each provider exposes a partial extractor — catalog ones (`catalogFromMal`, `catalogFromAnilist`, …) live in `domain/animeUtils.ts`; the **personal** ones live in [src/lib/providers/personalState.ts](src/lib/providers/personalState.ts) because they are shared with discrepancy detection (see below). A generic precedence merge walks every field and takes the first source in precedence order with a defined value, recording the winner in `provenance`. Catalog precedence is **per field** (`catalogPrecedenceFor(field)` over `CATALOG_PRECEDENCE_BY_FIELD` layered on `DEFAULT_CATALOG_PRECEDENCE`, MAL-first); personal precedence is one decision for the whole block, SIMKL > MAL > AniList (`DEFAULT_PERSONAL_PRECEDENCE`). `genres` is the one catalog field NOT decided by precedence — `unionGenres` merges it element-wise afterwards and overrides whatever the merge chose, so `provenance.catalog.genres` means nothing and `/precedence` reports it as `union`.
- **Catalog precedence is user-configurable** (`/settings`, E5 — docs/DECISIONS.md). `settings.json`'s `catalogPrecedence` map layers over the shipped `CATALOG_PRECEDENCE_BY_FIELD`, resolved by `getCatalogPrecedenceByField()` in `config/settings.ts` — **the single seam**: `getAnimeForDisplay` threads it into the merge AND folds it into the row-cache key (so a save repoints every affected field immediately), and `/precedence` renders from it rather than from the constant, or the one page whose job is to be trusted about the merge would report the shipped default while the merge used the user's choice. The editor offers only the fields BOTH contributors produce (`CONFIGURABLE_CATALOG_FIELDS`, minus `genres`) and only `mal`/`anilist` as winners (`CATALOG_CONTRIBUTORS`) — SIMKL and local return `{}` from their catalog extractors, so ordering them is a knob attached to nothing. The stored shape is still a full ordering array, so the mechanism stays general; `sanitizeCatalogPrecedence` drops entries that match what the field already resolves to, keeping the store sparse so a future change to the shipped defaults isn't frozen by a no-op.
- **The three axes inside `genres` are a derived lookup, not three fields** ([src/lib/domain/genreAxis.ts](src/lib/domain/genreAxis.ts), docs/DECISIONS.md, E3). MAL's `genres` conflates genre proper, theme/setting and demographic; `genreAxis(name)` splits them as a **pure function of the name**, which works because names are already the identity key (the same property that lets `unionGenres` dedupe across providers). Consequence: **no new catalog fields, no precedence entries, no migration** — and a misclassification is fixed by editing an array, not by re-running a sync. Genre and demographic are **whitelists** (closed sets — AniList's `GenreCollection` transcribed, plus 5 demographics and 6 MAL-only genres); `theme` is the **fall-through**, so a genre a provider adds later is imprecise but never unclassified. ⚠️ The whitelist must go through the same `GENRE_ALIASES` map the union uses: the store holds MAL's `Suspense` while AniList's collection says `Thriller`, so skipping the alias silently misfiles a genre as a theme. Live split: 78 values → 25 / 5 / 48.
- **The genre filter is ONE dimension with three presentation groups.** `AnimeFiltersState.genres` (URL key `g`) carries all three axes in one list — the split never reaches the URL or the store, only [GenresSection](src/components/anime/sidebar/GenresSection.tsx). Its vocabulary comes from `GET /api/anime/genres` (memoized on the row array's identity) rather than a constant, because only the store knows which names are actually carried and `theme` is open by construction. **`/recommendations` renders the same component** off its own `g` key (`RecoUrlState.genres`), so the two pages share one genre filter rather than two; `/tier` keeps a flat inline list instead, on purpose — its scope is the ~600-title statused list, and the catalog-wide vocabulary would offer genres no card on the board carries. Note the vocabulary's counts are always catalog-wide, so on the feed they read as "how common is this genre", not "how many results". Note the API's `genres` param predated any UI by a long way — nothing sent it until the filter shipped.
- **`/precedence?id=<canonicalId>`** is the inspector (E6): per catalog field, the winning provider, the ordering in force, the effective value and every provider's raw value, contested fields first. A pure reader over `explainCatalogPrecedence`. Deliberately untranslated — the content is field identifiers, provider ids and raw JSON.
- **The inline counterpart is [ProvenanceChip](src/components/anime/ProvenanceChip.tsx)** on the detail page — a tiny provider label beside the title, synopsis, genres, studios and every catalog-sheet field, answering the same question where the value is actually read. Three states, matching the inspector's own colours: *settled* (one provider had it — dimmed, because it decided nothing), *contested* (amber, precedence arbitrated), *union* (`∪`, `genres` only). It renders from `catalogFieldOrigins()`, the lean projection of `explainCatalogPrecedence` — **never off `record.provenance.catalog` directly**, or `genres` would name whichever provider the merge picked before `unionGenres` overrode it. The detail page builds it in `getServerSideProps` under `getCatalogPrecedenceByField()`, same reason `/precedence` does: reading the shipped constant would describe an ordering the record wasn't built with. No chip on "added/updated on MAL" — those are raw-slice reads by nature (K7), with no precedence question to report.
- **`getEffectiveStatus`/`getEffectiveScore`/`getEffectiveProgress`** in `domain/animeUtils.ts` are now thin reads of the already-hydrated `record.personal.*` — the SIMKL>MAL>AniList precedence itself lives in the hydration engine above, not in these three helpers. They're kept as the read seam: every personal read used for filtering, seeding, or exclusion still goes through them rather than reading `.sources.*` directly.
- **Provider ids are converted to canonical ids AT THE BOUNDARY, and nothing downstream speaks a provider id.** External data arriving keyed by a provider id (crowd edges as MAL ids, AniList recommendation edges as AniList ids) is resolved via `buildCrosswalkIndexes()` where it enters — `refresh.ts` for the feed, the `similar/[id]` route for the drill-down. Past that boundary `computeFeed` / `computeSimilarTo` / `byCredits` and `cache/recommendations.json` are all canonical. Each provider method still takes **its own** id out of the crosswalk (AniList methods take AniList ids, MAL methods take MAL ids), and **if the crosswalk holds no id for a provider, that provider simply does not enrich that title** — no gap-bridging, no foreign key promoted to a primary key. *This supersedes the older "the reco engine stays MAL-keyed internally by design" stance (B3), which was right that crowd edges ARRIVE as MAL ids and wrong to let them stay that way; E8–E11 did the conversion (docs/DECISIONS.md).* The conversion is **resolve-only, never mint**: minting for an unhydratable edge would seed `registry.json` with entries no slice backs, and `getAnimeForDisplay` unions the registry's keys, so each would surface as a phantom row.
- **Relation edges are the one provider-id payload left, and they are resolved, not compared.** [src/lib/domain/relations.ts](src/lib/domain/relations.ts) is the single seam: `buildRelationIndex(records)` + `resolveRelations(anime, index)` union MAL's `catalog.relatedAnime` with AniList's `sources.anilist.relations`, normalize AniList's vocabulary into MAL's, and hand back the **target record** rather than an id. Every consumer goes through it — the detail page's relations section, `isPrematureSequel`, the franchise exclusions in `similar.ts`/`byCredits.ts`, and `groupIntoFranchises`. Reading `catalog.relatedAnime` directly is the bug it exists to prevent: MAL only returns relations from its single-title *detail* endpoint, so that field alone is populated on **48 of 25,391** titles against AniList's 11,419 — every relation-dependent behaviour was silently dead. Do NOT "fix" this by merging AniList into `catalog.relatedAnime`: that field's `node` carries a MAL id plus a title and picture, which an `AniListRelationEntry` has not got.
- Legacy MAL-numeric-id URLs (bookmarks predating the cutover) resolve via `resolveByMalId()` and redirect to the canonical URL — a **convenience for one user's bookmarks, not an invariant**; it can go the day it costs something. `/rate?id=` is the one remaining genuinely-MAL-id-keyed route (`getAnimeByIdForDisplay()`), by design.

**Deliberate MAL couplings that STAY — stop re-flagging these** (K4–K7). Each is join identity or a provider-specific datum, not a precedence exception, and the distinction is the whole point (docs/DECISIONS.md): *"precedence has no exceptions" and "some things are legitimately MAL-keyed" are both true, because they operate on different layers* — precedence decides which provider **fills a field**, join identity decides which key **groups records**.

| # | Item | Where | Why it stays |
|---|---|---|---|
| K4 | `/rate?id=` is MAL-id-keyed | `pages/rate.tsx` | The Rating Calculator is a MAL-scale tool; genuinely MAL-keyed by design |
| K5 | `getMalIdForCanonical` consults the MAL catalog slice | `store/slices.ts` | A crosswalk read; the registry must stay *below* the slices so slice writes can resolve ids without a cycle |
| K6 | Legacy MAL-numeric-id URL redirects | `resolveByMalId()` | Bookmark compatibility |
| K7 | "Added to MAL" / "Updated on MAL" on the detail page | `anime/[id].tsx` | A provider-specific datum with no neutral equivalent — see the E7 rule on `AnimeSources` |

### CSS Modules with generated typings

**Components** use CSS Modules (`ComponentName.module.css`); **pages** use `<style jsx>` for their own one-off layout (`index.tsx`, `anime/[id].tsx`, `tier.tsx`, `recommendations.tsx` and `connections.tsx` all do). Follow whichever convention matches the file you are editing. Type definition files (`.module.css.d.ts`) are auto-generated by `typed-css-modules`. **Always run `npm run css:types` after modifying any `.module.css` file.** Classes use camelCase. Colors come from CSS custom properties defined in [src/styles/globals.css](src/styles/globals.css).

⚠️ **styled-jsx only scopes JSX inside the component's own `return`, and it suffixes EVERY compound in a selector chain** — `.foo .bar` compiles to `.foo.jsx-x .bar.jsx-x`. So a rule written in `<style jsx>` silently does **nothing** for markup produced by a `renderRow`-style helper or held in a hoisted `const sidebar = (…)`, because those elements never receive the scope class. **Live-confirmed 2026-08-23** on a production build, which is also how to re-check it: `document.querySelector('.bx-side .hint').classList` is `["hint"]` while `.bx-main .bx-header` is `["jsx-2d81…", "bx-header"]`. ⚠️ Consequently `catch-up.tsx`'s own `.hint` rule, which sits in its SCOPED block while every `.hint` element lives in its hoisted sidebar, is dead — treat the existing pages as examples of the split, not as proof they got it right. It is why `catch-up.tsx` and `tier.tsx` each carry a SECOND `<style jsx global>` block whose selectors are all prefixed with a page-unique root class (`.cu-main …`), letting that prefix do the scoping instead. Follow that split when adding a page — scoped block for the returned tree, global block for helper- and sidebar-rendered markup — and remember an unprefixed rule in the global block really is global. The failure mode is invisible in review and in the build: the page compiles, the class name appears in the DOM, and the styles are simply absent. ⚠️ **A backtick inside a CSS comment in either block terminates the template literal** and produces a wall of unrelated JSX syntax errors — never write `.foo .bar` in those comments.

### Key data flow

1. `index.tsx` fetches `/api/anime/animes` with filter params derived from the URL state
2. API handler at [src/pages/api/anime/animes/index.ts](src/pages/api/anime/animes/index.ts) calls `getAnimeForDisplay()` then applies filtering/sorting via [src/lib/domain/animeUtils.ts](src/lib/domain/animeUtils.ts)
3. Results render in `AnimeCardView` — the **only** list layout, inside `AnimePageLayout` with `AnimeSidebar` and [AnimeListHeader](src/components/anime/AnimeListHeader.tsx). The `AnimeTable` alternative and its `layout`/`lt` URL key were removed (unused since the card view landed); an old `?lt=table` bookmark just ignores the param — that removal is the house style: **delete the unused thing rather than keep it working**. That took the main list's one inline personal editor with it — editing lives on `/tier`, `/quick-rate` and the detail page's `PersonalStateEditor`. `VisibleColumns` / the `cols` URL key went too: four of the five columns were table-only, and the fifth (`score`) is now unconditional on the card.
4. **The two control surfaces split by question, not by convenience.** `AnimeSidebar` answers *which* anime (search, views, filters); `AnimeListHeader` — a bar above the grid, SIMKL-style — answers *how they look* (sort, cards per row) plus the result count. Both drive URL updates via callbacks from `index.tsx`; nothing else moved, the header just re-renders `SortOrderSection`/`DisplaySection` with `variant="inline"`. **That variant is CSS-only** (one class flipping `flex-direction`), because `/recommendations` still renders `DisplaySection` as a stacked sidebar section — branching the markup would fork controls that must stay identical. The header is one flat wrapping flex row rather than count+controls nested: the TV target is 4K at 300% zoom ≈ 1280 CSS px, and a nested control block drops onto a line of its own there.
5. **"Image size" is gone, and `ImageSize` is now `/tier`-only.** Those four buttons sized the *table's* thumbnails; `AnimeCardView` took the prop and never read it (its grid is `cardsPerRow` or `minmax(280px, 1fr)`), so they were a visible no-op on `/` **and** `/recommendations` — verified live, `img=0` and `img=1` rendered identical 406×608 posters. The control, the `img` URL key and the dead prop were removed rather than given a new meaning, since cards-per-row already answers "how big are the cards". `/tier`'s S/M/L/XL `thumbSize` buttons are a separate, genuinely wired control that still uses the `ImageSize` type.
6. **The season filter has two selectors behind one seam**, [SeasonFilter](src/components/anime/SeasonFilter.tsx) — the only thing `/` and `/tier` mount. Default is [SeasonPicker](src/components/anime/SeasonPicker.tsx): ONE season, a searchable dropdown ordered `(year, season)` DESC (`listSeasonsDesc()`, derived arithmetic from `next` back to `EARLIEST_SEASON_YEAR = 1960` — a season with no rows is a legitimate empty answer, so it does not ask the catalog), flanked by prev/next steppers that walk `shiftSeason` one step at a time. Clearing writes `[]`, which is what drops `sn` from the URL. The legacy multi-season chip list survives as `SeasonSelector`; both write the same `SeasonInfo[]`, so a URL written in one mode is readable in the other. **The mode is a `localStorage` preference** ([useSeasonSelectorMode](src/hooks/useSeasonSelectorMode.ts), `anime-app.seasonSelectorMode`), not a URL key: it says how the control *looks*, not which anime are shown, and one preference beats a persistent key on each of the two surfaces. Same hydration rule as the language toggle — server and first client render use the default. Two details worth keeping: the picker labels seasons **year-first** (`2026 Automne`) so the years line up down the column, and its `position: fixed` panel **flips above the field** when the room below is short, because the season block sits low in a long sidebar.

### "Pour toi" recommendations — a dedicated page, NOT a view

The recommendation feed is a **computed candidate set + affinity ranking**, which is not expressible as a filter combination. It therefore lives on its own route [src/pages/recommendations.tsx](src/pages/recommendations.tsx) with its own URL state ([useRecommendationsUrlState](src/hooks/useRecommendationsUrlState.ts)) — it does **not** pollute `AnimeFiltersState`/`VIEW_PRESETS`. The page composes the existing sidebar section components (Account, Recommendations, RecoFilters, Display) directly rather than reusing the monolithic `AnimeSidebar`.

It renders **the same `AnimeListHeader` as `/`** (see "Key data flow" above), so the two pages read as one app: cards-per-row and the "show all explains" toggle live in that bar rather than in a sidebar `Affichage` section. What differs is passed as slots — a `title` (which names the feed, or the review list), a `count` that swaps to a back button in the `rev` sub-views, and the toggle as `children`. It passes **no `sort`**: the feed's order *is* the affinity ranking, so a sort control would contradict the page. **`sort` and `display` are both optional groups** (`/tier` fills neither — its rows are wrapped thumbnails, not a card grid), and the header places dividers *between whichever groups a page filled* rather than hardcoding one after `sort`, which with two optional groups would be orphaned or missing depending on the combination. Making the header's shell fixed and its content slot-driven is deliberate — the earlier version had each page style its own bar, and they drifted (one bordered panel, one bare row).

Ranking + fetch logic live in `src/lib/reco/`, split along the engine's own seam — the expensive **fetch** ([refresh.ts](src/lib/reco/refresh.ts)) writes `cache/recommendations.json` ([data.ts](src/lib/reco/data.ts)); the cheap **ranking** ([feed.ts](src/lib/reco/feed.ts)) recomputes the whole feed live from it, so changing a knob never triggers a re-fetch. The scoring math itself is the **client-safe** [scoring.ts](src/lib/reco/scoring.ts) (IDF, taste profiles, `fieldMatch`, `isPrematureSequel`, and `TUNING` — every knob in one place), shared with [anchored.ts](src/lib/reco/anchored.ts) (the N-anchor ranker behind "Plus comme ça" and `/mix` — see below); [feedback.ts](src/lib/reco/feedback.ts) owns the 👍/👎 store. Endpoints under `src/pages/api/anime/recommendations/` (GET feed, POST refresh via SSE, POST/DELETE `feedback/[id]`).

**The refresh runs with or without a MAL account** (B4 — docs/DECISIONS.md). `performRecommendationsRefresh` takes `accessToken: string | null`; with `null` the two MAL sources (crowd edges, personal suggestions) and the niche 2-hop are skipped, and the anonymous `anilistCrowd` source carries the feed alone. **Candidate hydration follows the same rule and is the load-bearing half** — `computeFeed` drops any candidate with no local record, so a keyless run hydrates through `fetchAnilistCatalog` (AniList queries by its OWN id, 50 per request, landing as a `catalog` block via `upsertAnilistCatalogFields`) instead of MAL's one-at-a-time `fetchAnimeDetail`. Every run returns a per-source `RecoRefreshSources` outcome map, also attached to the terminal SSE `complete` event, so a degraded run is declared rather than merely thinner. Don't reintroduce a `requireMalAuth` gate here: the engine needs MAL *ids* (which AniList supplies free), not a MAL *session* — that distinction is the whole of B4, and B3 is the unrelated one. The *narrowing* filters that DO apply to the feed (media type, search, `mean` score range, release-year range, genres) go through the shared `applyNarrowingFilters` in [src/lib/domain/animeUtils.ts](src/lib/domain/animeUtils.ts) — the same function the main `/api/anime/animes` handler uses, so there is one filter implementation, not two. Status filter and sort do NOT apply (replaced by the hard "unseen" filter and affinity ranking).

**Scoring model (weighted sources).** `computeFeed` scores each candidate as an additive weighted sum `score = Σ weight · normalizedSourceValue`, where each source value is normalized to `[0,1]`. Sources: `crowd` (MAL crowd recos from seeds — the anchor), `suggestions` (MAL suggestions endpoint), `feedback` (affinity to the user's 👍 set — see below), `genre`/`studio`/`nsfw`/`rating`/`anilistTags`/`anilistStaff` (IDF-weighted taste-profile affinity — rare values carry more signal), plus `rejection`, `crowdRejection` and `popularity` which default to **negative** weights. The candidate set stays anchored to crowd-edge targets + suggestions; the metadata sources only re-rank within it (they never inject new candidates). Each card carries a per-source `recoMeta.breakdown` powering the on-demand "Pourquoi ?" explain. Per-source weights are the tunable knobs, persisted in the URL as a single packed `w=crowd:1,studio:.8` param. **`DEFAULT_WEIGHTS`, the URL (de)serialization, and the UI metadata all live in the client-safe [src/lib/reco/weights.ts](src/lib/reco/weights.ts)** — never import them from the `fs`-bound reco modules (`feed.ts` / `refresh.ts` / `similar.ts`). Sidebar sliders in `RecoWeightsSection` commit to the URL on release (not per-tick) to avoid history spam.

**Measuring a ranking change — `node scripts/backtest-reco.js --cutoff YYYY-MM-DD`.** `affinityScore` is a hand-weighted sum with no ground truth, so every knob used to be tuned by eyeballing the feed. The harness replays history instead: it builds a temp store that looks like the real one did before a cutoff (post-cutoff personal entries stripped from all four slices), runs the REAL `computeFeed` against it, and asks where the titles the owner *went on to complete and score >= 8* landed. Reports `reachable` (the ceiling — positives in the candidate pool at all), `recall@k` and MRR.

- **`personal/simkl.json`'s `watched_at` is the clock**, and it is the only usable one: 650/691 coverage and a genuine watch date (Evangelion aired 1995, stamped 2026-05). MAL's `updated_at` cannot serve — 463 of 712 entries carry the same 2026-07 bulk-sync timestamp. AniList's import carries no date at all.
- ⚠️ **Pruning the reco cache's seeds is load-bearing, not tidiness.** `cache/recommendations.json` was fetched from *today's* seeds, so a post-cutoff favourite is in the pool partly BECAUSE it is now a seed itself. Dropping every seed the owner had not yet watched (including the negative ones) is what stops the harness from grading the engine on its own answers.
- **The numbers are comparable run-to-run, never absolute.** The surviving edges are still today's crowd graph rather than the cutoff's, and the pool is smaller than a real point-in-time refresh would have produced. Read the direction of a change, not the magnitude.
- **Check more than one cutoff, and prefer MRR.** The reachable set is 44-56 titles, so a single cutoff moves on noise. MRR and `recall@10` describe the top of the feed — the only part actually read; mean/median rank describe the middle and can move the opposite way. Two changes were rejected on exactly that split (see the ⚠️ on `staffT1Extractor`).

**Three scoring fixes came out of that harness** (docs/audits/recommend-algo-notes.md, an external audit of the MCP's output):

- **`popularity` was a ratio, not a normalization** — `log10(users)/log10(maxUsers)`, with no minimum subtracted. Since a candidate pool is made of titles the crowd already recommends, its members sit within about one order of magnitude of each other, so the value never left `[0.488, 1.0]` (IQR 0.107) and the -0.15 weight acted as a near-constant offset. `popularityScale(min, max)` in `scoring.ts` is the shared fix, used by `feed.ts` and `anchored.ts`.
- **`suggestions` threw away MAL's ordering** — the source scored a flat `1` for all 100 suggestions while `data.suggestions[].rank` sat unused in the cache. Now discounted `1/log2(1+rank)`. Measured: `recall@50` 20.5% → 22.7%, MRR 0.0523 → 0.0542.
- **`seedGapBonus`** re-weights a seed by how far the owner out-scored the community on it (a 10 on a MAL-7.4 title says more than a 10 on a MAL-8.4 one). ⚠️ **Bounded and multiplicative on purpose** — the raw `score − mean` the audit proposed is negative for a large share of seeds (they skew toward titles the crowd also rates 8+, and this owner's mean gap is −0.57), which would silently drop half the seed set and make the rest subtract their own backers. `TUNING.SEED_GAP_BONUS = 0` disables it; the measured effect is small (MRR +0.001 at three cutoffs, `recall@250` slightly down).

⚠️ **Two changes from that audit were built, measured WORSE, and reverted. Do not re-add them without re-running the harness.**

- **Negative crowd seeds** — fetching the crowd edges OF the dislike set (dropped / scored <= 5 / 👎) and subtracting them, which the audit ranked as its highest-leverage item. Built end to end and measured against a real refresh (144 disliked titles, 842 MAL + 1,916 AniList edges): **every non-zero weight scored worse than zero, monotonically**, MRR falling at all three cutoffs (0.0547→0.0484, 0.0467→0.0401, 0.0505→0.0432 at -0.4). The reason is that the crowd graph is largely an adjacency/popularity graph, so the dislike neighbourhood is *not* orthogonal to the seed neighbourhood — measured Pearson **r = +0.34** between the positive and negative crowd values, and the top-100 candidates by `crowd` carry nearly double the pool's mean negative value (0.326 vs 0.178). It does not add a signal; it partially cancels `crowd`, the feed's anchor. Note the content-based `rejection` profile does not have this problem because `buildDiscriminativeProfiles` NETS the two sides — the crowd graph has no such netting, which is precisely what is missing. Also worth weighing against a retry: it cost 143 extra MAL requests per refresh.
- **Narrowing the positive `anilistStaff` source to T1** — see the ⚠️ on `staffT1Extractor` in `scoring.ts`.

⚠️ **The audit's two wrong claims were both caused by the MCP surface, not by the reader, and both are now fixed** — a defective explanation surface produces confident wrong conclusions, so treat these as bugs of the same weight as a scoring bug.

- **`projectWhy` in [mcp/tools.ts](src/lib/mcp/tools.ts) trimmed by absolute contribution**, which structurally erased the negative half: `crowd` is max-normalized to 1.0 at the top of the pool while `rejection` sits around 0.03, so a single `slice(0, 4)` cut dropped it from every card. Live-measured before the fix — `rejection` contributed on **15 of 15** top cards and surfaced on **0**, `rating` likewise. The audit concluded the dropped list was unused signal and proposed rebuilding it; that was a correct inference from what the tool showed. Now trimmed **per sign** (`WHY_POSITIVE_LIMIT` / `WHY_NEGATIVE_LIMIT`), and rounded before the zero filter so a −0.0004 is omitted rather than rendered as a misleading `0`. Shared with `similar_to`, which had the same blind spot.
- **`becauseOf` is positive by construction** (a seed IS a highly-scored completion) but reads like the whole explanation. The `recommend` tool description now says so, and states outright that negative `contribution` values are model output — the same reason `tier_list`'s description now spells out its filter asymmetry.

The audit's remaining ideas were assessed and not built: a **predicted-rating model** over the 653 labelled titles (selection bias — labels exist only on titles the owner chose to watch; plus feature leakage, since every score->=8 completion is itself a seed), a **P(drop) classifier** (~138 labels, and a drop is a verdict on writing, which no catalog field encodes), and a **`num_episodes` commitment knob** (a preference, not an accuracy claim — the harness cannot falsify it, so it would be exactly the kind of eyeballed knob the harness exists to prevent).

**The taste profiles are DISCRIMINATIVE, not two independent tallies** (`buildDiscriminativeProfiles` in [scoring.ts](src/lib/reco/scoring.ts)). `genre`/`studio` and the `rejection` side are built as a netted pair: each side's per-value **rate** (share of that set's mass, so the ~280 seeds and the ~138 dislikes are comparable at all) minus `TUNING.DISCRIMINATION ×` the other's. A value equally present in both says nothing about what you will drop, so it now scores on **neither** side — before, it scored on both at once. Measured on the live store: negative genre values 65 → 35, with `Drama` (0.87), `Action` (0.77) and `Shounen` (0.73) leaving the rejection profile entirely while staying positive, and `Production I.G` / `Madhouse` likewise; what survives is what really concentrates in the drops (`Romance`, `Ecchi`, studios seen only there). The positive side shifts too — it now leads with what *separates* liked from dropped (`Psychological`, `Military`) rather than with whatever is merely frequent.

⚠️ **Do NOT "fix" this by widening the rejection side to more content fields.** Genre, studio and tags describe what a show is *about*; a drop is usually a verdict on how it was *written*, which no catalog field encodes — so more content fields teach the wrong lesson faster. Netting needs no such guess: non-predictive values fall out on their own. The one field that does carry the verdict is staff, hence `rejection` = `REJECTION_MIX` over genre `0.35` / studio `0.25` / **`staffT1` `0.4`** — `staffT1Extractor`, the T1 auteur tier from [staffRole.ts](src/lib/domain/staffRole.ts) (director, series composition, character design, music…). **T1, not the full top-50**: `fieldMatch` divides by the candidate's value count, and the live store measures **5.2 T1 credits per title against 40.8 total**, so the full list dilutes a series composer to noise while T1 sits on roughly genre's scale. Deliberately not a `MetaField` (that would add a seventh IDF pass and a positive profile nothing reads); it reuses `idf.anilistStaff`, which measures how rare the *person* is — the same question whatever the role. Coverage on the live store is 138/138 dislikes; an unsynced store scores it 0, which weakens the penalty rather than skewing it.

`TUNING.GENRE_WEIGHT`/`STUDIO_WEIGHT` (0.6/0.4) now serve **only** the 👍 `feedback` profile — they are not the rejection mix.

**Feedback (👍 "bonne pioche" / 👎 "pas pour moi").** Durable standalone store `user/reco_feedback.json` (`id → 'up'|'down'`) in `DATA_PATH`, decoupled from the transient feed. Thumbing a feed card files the verdict and removes it; **both** up and down ids are hard-excluded from the feed server-side in `computeFeed` (a 👍'd title isn't in the MAL list, so without this it would resurrect on reload). Two effects: (1) **re-rank** — the `feedback` source is an IDF-weighted genre+studio profile over the 👍 set (own tunable slider, shows in the explain as "Comme tes bonnes pioches …"); 👎 items fold into the existing `rejection` profile (hide + negative taste, no separate slider — an intentional 👍/👎 asymmetry). (2) **reshape** — at refresh, 👍 anime join the crowd **seeds** (synthetic `FEEDBACK_SEED_WEIGHT`, no MAL score) so their MAL crowd recos pull *new* candidates into the feed. The `dismissed` sub-view is replaced by two review-and-undo lists (`?rev=up` / `?rev=down`). URL key `rev`. The legacy pure-hide `user/reco_dismissed.json` is **gone** — it was kept read-only "so dismissed titles stay excluded", but no such file existed on the live store, so the exclusion and its MAL-keyed lookup were dead weight.

### MAL sync

- `/api/anime/mal/sync` — lightweight personal list sync (updates `my_list_status` on existing anime only, never inserts)
- `/api/anime/mal/big-sync` — full seasonal sync, fetches 8 years of seasons + upcoming ranking via MAL API, SSE progress streaming
- `/api/anime/mal/historical-crawl` — GET returns crawl stats; POST runs a 5-season batch crawl going back to 1960. Uses a module-level lock to prevent concurrent runs. Cron-sync also calls this directly from lib after triggering big-sync.
- `/api/anime/mal/auth` — MAL OAuth (`login` / `status` / `logout` + the callback), one shape with `simkl/auth` and `anilist/auth`. It lived at the generic `/api/anime/auth` until 2026-07-25, from when MAL was the only provider; being the OAuth app's **registered redirect URI** kept it there, which is a one-time edit at https://myanimelist.net/apiconfig, not a reason to own the generic path. `getMalRedirectUri` derives the new path, so moving it again means re-registering again.
- `/api/anime/cron-sync` — cron-triggered, authenticated via `CRON_SECRET` header. Stays outside `mal/` on purpose: an external cron job on the NAS calls this exact path, and it spans **every** provider, not just MAL. See "Scheduled sync (cron-sync)" below for what it runs.
- `/api/anime/animes/[id]/refresh` (POST) — on-demand single-title refill from ALL THREE sources in parallel (MAL single-title GET merged over the local record, AniList force-refetch of tags+staff+banner+relations — by MAL id when there is one, by AniList id otherwise, so it works on a MAL-less title; SIMKL incremental sync). Each source is isolated/non-fatal; returns a per-source `{ mal, anilist, simkl }` outcome. Backs the detail-page `RefreshButton`.

### SIMKL integration (read-only)

A second, read-only personal-data source alongside MAL. SIMKL data lives in a lean side-file `personal/simkl.json` (env `DATA_PATH`), **keyed by canonical id**, storing SIMKL-unique personal fields (`SimklPersonalEntry`: status normalized to MAL vocabulary, score, progress, watched date, the `simkl` id, and the full cross-source `ids` crosswalk). It is **joined onto the record in `getAnimeForDisplay()`** exactly like `user/hidden.json`. MAL stays the **catalog** authority, but SIMKL is now the **personal-state** authority: see "Local cache authority" below.

- Sync is **one-way (SIMKL → app), personal library only** (statused anime), following SIMKL's two-phase model (`docs/simkl/apirules.md`): initial `/sync/all-items/anime` (plain — NOT `extended=ids_only`, which strips per-item status/rating/progress; the plain call already returns those plus full `ids` incl. `mal`, verified against a live account), then `/sync/activities` + `date_from` deltas, with `sync/simkl_checkpoint.json` holding the `anime.all` watermark. **Rating-only edits are a delta blind spot** (verified live 2026-07-06): a freshly-rated title does NOT appear in `all-items?date_from=…` even though its `activities.anime.rated_at`/`all` advanced — so the checkpoint also tracks `lastRatedAt`, and when it moves the sync falls back to a **FULL** `all-items` pull to capture the new score. Existing checkpoints predate `lastRatedAt` (undefined), so the first sync after this shipped does one backfilling full pull. Deletion reconciliation diffs `extended=simkl_ids_only` against the local store. Orchestration in [src/lib/providers/simkl/sync.ts](src/lib/providers/simkl/sync.ts); auth/state/watermark in [src/lib/providers/simkl/client.ts](src/lib/providers/simkl/client.ts); endpoints under `src/pages/api/anime/simkl/` (`auth`, `sync`). **Writes to SIMKL are limited to TWO narrow carve-outs, both user-initiated: a rating** (pushed from the Tier list board, see below) **and a removal from the list** (`removeSimklEntry`, `POST /sync/history/remove`, the SIMKL half of "clear status"). Nothing automatic ever writes to SIMKL — sync remains one-way SIMKL → app. Removal had to join: SIMKL is **first** in personal precedence, so clearing MAL + AniList while leaving SIMKL's entry would leave `getEffectiveStatus` still returning a status — a "clear" that visibly does nothing. ⚠️ SIMKL's `deleted` counter is **not an effect signal** (live-measured: removing an already-absent entry still answered `201 deleted.shows: 1` — it echoes the request); only `not_found` is meaningful, and only about whether SIMKL knows the title.
- **Discrepancy detection** is no longer SIMKL-specific — see "Local personal-data provider" below.
- ⚠️ **SIMKL's foreign keys are NOT trustworthy; its own id is.** SIMKL routinely files a chibi/short companion series' MAL id on the MAIN show's record, and the payload contradicts *itself* when it does — live-measured, simkl 1670325 `Youjo Senki II` reports `ids.mal` = 64577 (*Youjo Shenki 2*, the chibi) alongside `ids.anilist` = 135865 (the main show). `resolveCanonicalIds` looks up **mal → anilist → simkl, first hit wins**, which is right for MAL- and AniList-sourced payloads and wrong for SIMKL's: the main show's watch state landed on the chibi, and the merge loop then copied SIMKL's whole `ids` block onto it. Three titles were affected (Re:Zero *Break Time 4th*, *Youjo Shenki 2*, *Akuyaku Reijou … Mini*), each surfacing as a second watched anime carrying the main show's score — and `anilistPush`, the one automated write, recreated it on AniList every cron tick. Two guards, both in effect:
  - **`simklCrosswalkFor` in [store/slices.ts](src/lib/store/slices.ts)**: when SIMKL's own id is already anchored to a canonical record and its `ids.mal` names a *different* one, the anchor wins and **every contested foreign id is discarded** — the crosswalk handed to `resolveCanonicalIds` carries `simkl` (+ SIMKL's slug) and nothing else. Dropping `mal` is not optional: leaving it in makes the merge loop OVERWRITE the anchor record's real MAL id with the chibi's. Do NOT "simplify" this into reordering `resolveCanonicalIds` to simkl-first — that order is correct for the other two providers, and `buildSimklIndex` is first-hit-wins, so a simkl-first order over a *contaminated* registry is decided by key iteration order.
  - **`dropOrphanedEntries` in [providers/simkl/sync.ts](src/lib/providers/simkl/sync.ts)**: one SIMKL library item owns exactly one canonical record. An entry whose `simkl_id` is anchored elsewhere is dropped. It runs on **every** delta, not behind `removed_from_list` like the remote id diff — it is local and free, and the drift it repairs has nothing to do with a deletion; gating it there is what let the duplicates accumulate unseen. Anchored *nowhere* is left alone (a registry gap, not a duplicate).
  - ⚠️ **Neither foreign key is reliably the wrong one**, so do not "improve" this by preferring `ids.anilist`: on four other titles (`K-On!!: Keikaku!`, `Jiyi Guanli Ju`, `Lycoris Recoil: Friends Are Thieves of Time.`, `Parco x Ginga Tokkyuu Milky☆Subway`) it is `ids.anilist` that names the parent while `ids.mal` is right. The rule keys on SIMKL's own id precisely because it does not have to guess. Those four must stay untouched no-ops — they are the regression test.
  - The store damage already done is repaired by the one-shot `node scripts/fix-simkl-crosswalk.js <dataPath> [--dry-run]`, which finds any provider id bound to more than one canonical record and strips the contaminated block from the non-native holder. Idempotent.
- Deferred: MAL-internal discrepancies. (The SIMKL delta is wired into cron-sync since F1.) (Catalog-wide **tags** were originally planned as a SIMKL "big-sync" — superseded, see below: SIMKL's public API has no tags field or tag-filterable endpoint, verified against its live OpenAPI spec.)

### Local cache authority (personal-state precedence)

The architecture moved from "MAL-authoritative" to **local-cache-authority**: the merged local record is authority; MAL / SIMKL / AniList are interchangeable, absent-tolerant refill pipes. The user notes anime in SIMKL (SIMKL → MAL one-way), so **SIMKL is the authority for PERSONAL fields**, MAL the fallback.

- **The seam is three helpers in [src/lib/domain/animeUtils.ts](src/lib/domain/animeUtils.ts)** — `getEffectiveStatus` / `getEffectiveScore` / `getEffectiveProgress` (SIMKL-first, MAL fallback; `0`/`null` score = unrated). They are thin reads of the hydrated `record.personal.*` block — the actual SIMKL>MAL>AniList precedence lives in the hydration engine's `DEFAULT_PERSONAL_PRECEDENCE` (see "Canonical-id store" above), not in these three functions. **Every personal read used for filtering, seeding, or exclusion MUST go through them** — never read `sources.malPersonal` directly in those paths. This is atomic: a half-flip crashes the feed for a SIMKL-only completion that has no MAL entry (`getSeeds` no longer guarantees one). Routed spots: status + `unrated` filters (`api/anime/animes`), and in `reco/feed.ts` `getSeeds`, the seed live-weight, `seedW`, the rejection profile, and `isPrematureSequel`'s prequel lookup. Catalog fields (`mean`, genres, studios…) stay MAL-first — the helpers are personal-only. `computeDiscrepancy` deliberately still compares RAW per-provider slices (`sources.malPersonal`/`sources.simkl`/`sources.local` — it detects mismatches, not the effective value).
- **The list view reads effective too** (`AnimeCardView`'s status badge). This was once a deliberate deferral — the card carried an explicit "MAL status" label and surfaced other providers only via the discrepancy badge — but under local-record authority with MAL opt-in it made the main list the one surface that looked *empty* to a SIMKL-/AniList-/local-only user, while `/tier`, `/stats` and `/quick-rate` showed their data. Fixed (C1 — docs/DECISIONS.md). Per-provider detail still lives on the `DiscrepancyBadge`, which is where it belongs. **The optimistic overlay had to follow the read**: `index.tsx`'s post-commit patch now writes `record.personal`, not `sources.mal.my_list_status` — the old overlay was invisible to an effective read, and was skipped outright on a title with no MAL slice.
- **Crosswalk-on-record, now load-bearing.** `record.crosswalk` (`SourceIds`) is assembled from every pipe: MAL self-id + SIMKL's rich `ids` block (mal, anilist, anidb, kitsu, tmdb, imdb…) captured at sync + AniList's own `idMal`-resolved id (authoritative over SIMKL's occasionally-mirrored `anilist`). Unlike its pre-cutover description, this is **not** merely informational: `registry.json` persists exactly this crosswalk keyed by canonical id, and `resolveCanonicalId(s)` in [store/registry.ts](src/lib/store/registry.ts) reads/writes it on every sync to mint-or-resolve the canonical id — it is the identity spine the whole store hangs off (see "Canonical-id store" above). Existing SIMKL entries backfill `ids` on their next sync.

### Local personal-data provider (in-app rating, no external account)

A fourth personal source — the app's own — so the whole thing is usable with no MAL/SIMKL account, and so the write path generalizes to future providers (an AniList writer). See docs/DECISIONS.md for the rulings behind it.

- **Provider identity is two modules, split on client-safety** (D2 — docs/DECISIONS.md). [src/lib/providers/capabilities.ts](src/lib/providers/capabilities.ts) is the **declarative** half — `PROVIDER_CAPABILITIES`, a `Record<ProvenanceSource, …>` (so a missing row is a compile error) declaring what each provider *is and can do*. **Roles are keys** (`catalog?` / `personal?`) and **each role carries its own auth kind**: AniList's catalog role is `anonymous` — the tags/staff sync and bulk crawl need no account — while its personal role is `oauth+secret`. One auth kind per *provider* cannot say that, which is why it is per role. Static data only, no fs: React components may import it, and the Connections page renders from it (see below). [src/lib/providers/registry.ts](src/lib/providers/registry.ts) is the **runtime** half (server-only — it reads the auth files) and the only place the two compose. A third module, [src/lib/providers/status.ts](src/lib/providers/status.ts), joins the two plus the personal slices into **one status row per provider** behind `GET /api/anime/providers` — the uniform *read* the UI needs; the per-provider `auth` endpoints keep owning the OAuth *flows*, which genuinely differ.
- **One enablement predicate**: `isPersonalProviderEnabled(id)` in `providers/registry.ts` — token **presence, not validity** for an external provider, the settings for `local`. `hasWritableExternal()` and `canClearStatus()` are queries over it + the descriptors, never hand-read auth files, and **writers carry no `isEnabled` of their own**. The local provider is enabled by default iff `hasWritableExternal()` is false, so an existing MAL/SIMKL user is unaffected (`local` is then absent from the precedence list entirely and a stray slice entry is never consulted). Settings expose `localProviderEnabled` / `localPrecedenceMode` (`auto` | `localTop` | `localBottom`); the pure math is `resolveLocalPrecedence` in `domain/animeUtils.ts`. `providers/registry.ts` is its own module to dodge the settings↔simkl import cycle.
- **Writes go through a registry**, [src/lib/providers/writers.ts](src/lib/providers/writers.ts): each `PersonalWriter` has `writeLocal` (sync) / `writeRemote` (async) — enablement is NOT a writer concern, the registry filters on `isPersonalProviderEnabled` — and `writePersonal(canonicalId, patch)` runs **every** local-authority write before **any** remote push (structurally encoding local-cache-authority), then fans the remotes out serially (SIMKL's 20s write-lock). It returns `{ found, outcomes: Record<providerId, WriteOutcome> }` — both `rating.ts` and `personal.ts` (`PUT /api/anime/animes/[id]/personal`, renamed from `mal-status` — a route fanning out to every enabled provider cannot be named after one) are collapsed onto it. **The patch is narrowed per provider from `supportedDimensions()` before either pass**, so a writer never checks its own capabilities: SIMKL is score-only *by declaration*, and the status/progress it cannot take come back as `WriteOutcome.unsupported` (plus `skipped` when nothing applied) instead of the bare `ok: true` that used to render as a success (D1). `ok` stays true for a discard — it is a **partial** write, not a failure, and the UI must distinguish the two (`PersonalStateEditor` shows a muted note; the red list is failures only). - **`PersonalPatch.status = null` is a REMOVAL, not a status write**, and it is the one path that inverts the ordering above. Every provider models "no status" as deleting the whole list entry (taking score and progress with it), so each `PersonalWriter` also has `deleteRemote` / `deleteLocal`, and `writePersonal` routes `status: null` to `deletePersonal` **before** any narrowing — removal is not a *dimension*, so SIMKL's score-only `write` declaration does not exclude it. All four providers now declare `personal.clearStatus`, so `canClearStatus()` is true on a normal multi-provider install and the detail-page control is no longer local-only.
  - **Remote first, and the local slice dropped only for providers whose remote confirmed.** The opposite of every other write here, for a specific reason: a local entry deleted while the remote survives does not persist as a visible discrepancy — it **silently reverts**. `importAnilistPersonalList` full-replaces `personal/anilist.json` (on the refresh button and every cron tick) and MAL's list sync rewrites `my_list_status` on existing entries, so the next sync restores the status the user just cleared, after the UI said it worked. A visible discrepancy would be the better failure. Do NOT "fix" this back to local-first.
  - **The three providers agree on nothing, so each writer normalizes its own "already gone"** (all live-measured): MAL's DELETE is **idempotent** (200 on an absent entry), AniList's second delete is **400** `"The selected id is invalid."`, and SIMKL's `deleted` counter reports 1 either way. `deleteAnilistEntry` also treats a stale/absent entry id as success — AniList's list-entry id is a *different id space* from the media id, rides free on `MediaListCollection` into `AniListPersonalEntry.entry_id`, but goes **stale** after any delete/recreate, so it is a hint with a live `MediaList(userId:, mediaId:)` fallback.
  - `personal.ts` **rejects `status: null` combined with `score`/`progress`** (400) rather than discarding them — the removal leaves nowhere for them to land.
- **The bootstrap surface** is [PersonalStateEditor](src/components/anime/PersonalStateEditor.tsx) on the detail page — the one control that takes an *unstatused catalog title* to statused + scored. It has to exist: the tier board only fetches already-statused titles and the reco feed needs completed+scored seeds, so a fresh local-only install renders empty everywhere else. No auto-complete on rating (that's /quick-rate's idea, not this page's).
- **Discrepancy detection is N-provider**, [src/lib/providers/discrepancy.ts](src/lib/providers/discrepancy.ts) (client-safe/pure, the old `simklCompare.ts`): `computeDiscrepancy(states)` takes a `Partial<Record<ProvenanceSource, ProviderPersonalState>>` and reports a per-provider map + which dimensions `disagree`. The map is built from the RAW slices by `buildProviderStates` in [src/lib/providers/personalState.ts](src/lib/providers/personalState.ts) — **the same per-provider extractor table hydration uses**, so all four providers (MAL, SIMKL, AniList, local) participate and a provider cannot be added to one path without the other. **A provider participates iff it appears in the resolved `personalPrecedence`** — one enablement predicate, not one per surface. Two rules worth knowing: differing progress where every present provider has watched all of **its own** total is not a disagreement (MAL 12/12 vs SIMKL 13/13); and **presence is deliberately asymmetric** — only "present somewhere, absent from the **anchor**" flags, because the anchor is the user's reference list while the others are subset feeds, and a symmetric rule would flag most of the list. The anchor is **one** provider, `presenceAnchors(precedence)` in `providers/capabilities.ts`: the first `listCoverage: 'full'` provider in the resolved precedence (MAL where connected, else AniList, else none — never both, which measured 430 of 671 titles flagged). `buildProviderStates` marks it `anchor: true` **and gives it a state even when it holds no entry** — a missing entry is the whole point of a presence split, so it cannot be represented by omission (this is what H1 accidentally broke: post-split `personal/mal.json` holds only statused titles, so presence detection silently stopped firing altogether until A2). The flag rides on the state rather than being an argument so `computeDiscrepancy` stays a pure function of what it is handed — the discrepancies page re-runs it client-side over a *filtered* subset of the same states. Surfaced by `DiscrepancyBadge`, the `discrepanciesOnly` (`disc`) URL filter, and the [discrepancies page](src/pages/discrepancies.tsx), which renders the **grouped long format** (one sub-row per provider under each anime) so a new provider costs a row, not a column.

### "/quick-rate" — franchise-bulk rating

A third rating surface, separable from localRating: one score fanned out over a whole **franchise**, and "just put a score, it counts as watched". Route `/quick-rate` with its own [useQuickRateUrlState](src/hooks/useQuickRateUrlState.ts), composing the sidebar sections like `/tier` does.

- **Franchise = connected component of the relation graph**, [src/lib/domain/franchise.ts](src/lib/domain/franchise.ts) (pure). Edges are undirected and restricted to sequel/prequel/side-story/parent — `alternative_version`/`other`/`spin_off` are excluded on purpose, because one bad merge sends a bulk score to the wrong show. Edge resolution is `domain/relations.ts`' job (see "Canonical-id store"); this module only walks what it returns, so the franchise filter matches **one** vocabulary and `PARENT` arriving as `parent_story` is not a special case here.
- **The relation data comes from AniList, not MAL.** MAL returns `related_anime` only from its single-title *detail* endpoint — its list/seasonal endpoints omit it, so a crawled catalog has relations for almost nothing (46 of 25,370 when this shipped). `AniListMetaEntry.relations` (`AniListRelationEntry[]`, ANIME targets only — an `ADAPTATION` edge's `idMal` is the *manga's*) is fetched in the SAME batch query as tags/staff/banner and backfills on the `undefined` signal, so populating it is one "Sync AniList Metadata" run. MAL edges are still unioned in. Each edge stores **both** ids (`idMal` optional, `id` = the target's AniList id) and `resolveRelations` tries MAL-first then AniList — keying on `idMal` alone silently dropped every edge into an AniList-only title.
- **Scope is the whole catalog, unstatused titles included** — the one hard difference from the tier board (statused-only), because the unseen seasons of a franchise are exactly what you want to sweep. That volume is why [api/anime/quick-rate](src/pages/api/anime/quick-rate.ts) does the grouping AND a lean projection server-side (never ship 25k `AnimeRecord`s), and why **filtering refetches** instead of running client-side. The narrowing filters select *seeds*; each seed then expands to its whole franchise — **except media type, which also re-applies to members**, because it answers "what kind of entry do I rate at all" rather than "which franchise", and a TV-only watcher must not have "set all" score the franchise's movies. Component index is cached on the row-cache array's identity; output is **paginated** 20 groups per page (`page` query param, `p` URL key), since no filter combination narrows ~25k titles to one screenful and the old 60-group cap simply hid the remainder.
- **Rating auto-completes here and only here** (`{score, status:'completed', progress: numEpisodes}`, progress omitted when the episode count is unknown). Page-scoped and opt-out-able via the `ac` URL key — a deliberate score-only edit on the detail page or tier board is never hijacked. Writes reuse the tier board’s serial queue over `PUT …/personal` → `writePersonal` (not score-only `rating`), optimistic with revert and per-provider failure badges.

### AniList tags + staff integration (read-only, no auth)

A third, read-only catalog-metadata source, added after confirming SIMKL's public API doesn't expose tags (only `genres`, which duplicates MAL). AniList's GraphQL API (`https://graphql.anilist.co`) is public/anonymous and exposes a rich tag taxonomy (`name`, `rank` 0-100 relevance, `category`) **and staff credits** (`role` + staff `id`/`name`) directly queryable by MAL id (`Media(idMal: Int, type: ANIME)`), so — unlike SIMKL — no id-resolution step is needed.

- **One transport for every AniList call**: [src/lib/providers/anilist/client.ts](src/lib/providers/anilist/client.ts) owns the endpoint, the ~2.1s throttle (~28 req/min, under AniList's degraded 30/min limit; normally 90/min), the one-shot `429`/`Retry-After` retry, and the optional Bearer header. **The throttle is a single module-level slot allocator, and that is the point** (docs/DECISIONS.md): the meta sync, cast sweep, catalog crawl, personal import and push sweep each used to carry a private copy of it, so any two running at once each respected 28 req/min while together exceeding the ceiling. Every AniList request in the process now queues on the same clock, and the sweep loops carry no `setTimeout` pacing of their own. Three entry points because the callers genuinely disagree about what an error is: `anilistQuery` (strict — HTTP or GraphQL errors throw; what the sweeps want), `anilistFetch` (raw envelope + status, for `cast.ts`, which reads a 404 as "AniList doesn't have this title"), `anilistGraphQL` (authenticated envelope passthrough, since AniList reports business errors in `errors` under a 200). **The queries stay with their callers** — the `Page.media`-vs-aliased-`Media`, one-id-filter and complexity-ceiling constraints below are per query, and `client.ts` knows nothing about them.
- Storage: `catalog/anilist.json` (`AniListMetaEntry`, keyed by canonical id), joined onto the record in `getAnimeForDisplay()` exactly like `personal/simkl.json`. Holds `tags`, `staff` (`AniListStaffEntry[]`, top-50 by relevance — two aliased pages of 25, AniList's per-page hard cap), `banner_image` AND `relations` (the franchise graph — see "/quick-rate" above). The latter two are optional and **a `undefined` field is the backfill signal** — that exists to keep the sweep *incremental* (it queues only what's missing), not because a from-scratch re-sync would be too costly. Adding a field the same way is the cheap move; making one required and re-running the whole sweep is also fine. `banner_image` is therefore written as an explicit `null` when AniList has none (common), so an absent banner never re-queues forever.
- Sync: [src/lib/providers/anilist/sync.ts](src/lib/providers/anilist/sync.ts)'s `performAnilistMetaSync()` fetches **tags + staff + bannerImage in one query per batch** (`Page(perPage:50){ media(id_in:$ids){ bannerImage tags … staffPage1: staff(sort:RELEVANCE, page:1, perPage:25){ edges{ role node } } staffPage2: staff(…, page:2, …) } }` — verified live to stay under AniList's query-complexity ceiling; `bannerImage` is a scalar and costs nothing, but staff must stay nested in `Page.media`, NOT an aliased `Media`, which null-bombs on any miss). **Incremental**: queues titles with no entry OR an entry lacking `staff`/`banner_image`/`relations` (so those backfill onto already-tagged titles). Gracefully skips ids AniList doesn't have.
  - **Staff depth is pages, not a perPage number**: 25 is AniList's hard cap on that connection (asking 50 returns 25), so depth only comes from more aliased pages. Aliasing a *connection inside* `Page.media` is fine and is a different thing from the aliased-`Media` null bomb — verified live, every sampled title populated both pages. The cap was 15 until 2026-07-25, which truncated 35% of the ~19k entries and cut real credits: AniList's RELEVANCE sort is only loosely importance-first (on AniList 8407, Theme Song Composition and Art Setting rank *below* per-episode key animation, at 30-35). Titles fully covered, measured over a 200-title sample of the live store: 67.5% at 15, 75.0% at 25, **84.5% at 50**. **Never read `staff.pageInfo.total` on page 1** — it reports a placeholder (500/lastPage 20 for a title that has 40); only the last page's pageInfo is truthful.
  - Raising the cap does NOT refill an existing store — `selectMetaTargets` queues on `staff === undefined`, and 15 credits look complete. `scripts/refill-anilist-staff.js` strips `staff` off every entry to re-arm that signal; then the normal sweep refills at no extra request cost (the widened staff rides the same query). That is the posture's delete-and-repull, not a version field on the entry.
- **ONE id space: AniList's own** (E8 — docs/DECISIONS.md). Every AniList query here — `TAGS_QUERY`, `CATALOG_BY_ANILIST_QUERY`, `RECS_QUERY`, `cast.ts`'s `CAST_QUERY` — filters on `id`/`id_in`, and `selectMetaTargets` scans the **registry** (not the MAL catalog slice — that scan could not even *name* a title MAL doesn't know) taking each title's AniList id. `idMal` is still SELECTED, as AniList declaring its own crosswalk; it is never a query key. **No AniList id in the crosswalk ⇒ AniList does not enrich that title** — and that costs nothing, because a title without one is precisely a title AniList never returned, so the old `idMal_in` route was guaranteed to miss. It cost ~122 requests a run that never converged. Coverage there is the **season crawl's** job: `syncAnilistDiscovery` in cron-sync runs a bounded current-season crawl before the sweeps so new MAL titles gain an AniList id, and `performAnilistBulkCatalogCrawl` is the depth tool. **A batch still carries exactly one id filter** — AniList applies a supplied-but-null argument as a real filter (see `cast.ts`), which is a hazard `id`-only avoids by construction rather than by discipline. The one surviving `Media(idMal:)` is `resolveAnilistMediaId` in `anilist/write.ts`: that is crosswalk *resolution for a write*, and refusing it would drop a user's rating rather than skip a metadata refill.
- `banner_image` is AniList's landscape key art — the one catalog field MAL has no equivalent of. The anime **detail page uses it as a full-page fixed backdrop** (crisp, at natural width, anchored top, masked into a blurred ambient fill of the same image + a grain layer). When it's null the page falls back to the portrait poster, which plays the ambient role only — a portrait cover-cropped to a wide viewport is a meaningless band, so it's blurred hard. All the tuning knobs are CSS vars on `.backdrop` in [src/pages/anime/[id].tsx](src/pages/anime/[id].tsx). The `.section` panels are deliberately translucent (incl. [MoreLikeThis.module.css](src/components/anime/MoreLikeThis.module.css), which carries its own copy of that style) so the backdrop reads through them. Triggered via "Sync AniList Metadata" on the Connections page (`POST /api/anime/anilist/meta-sync`, fire-and-forget like `big-sync`); progress via `appendLog('anilist-meta-sync', …)` polled by the connection log panel, not SSE.
- Reco sources: `anilistTags` AND `anilistStaff` are `MetaField`s (these two keep the `Tags` name — they really are tag- and staff-specific, and `anilistTags` is persisted in the URL weights param) in [src/lib/reco/scoring.ts](src/lib/reco/scoring.ts), both following the exact `genre`/`studio` IDF-weighted-affinity pattern (tags = plain tag-name list; staff = stable AniList staff `id`, so a shared director/composer is a rare, strong signal; `role` feeds the "Pourquoi?" explain). Neither folds AniList's `rank` into scoring yet. Both ship at weight `0` by default in [src/lib/reco/weights.ts](src/lib/reco/weights.ts) until a sync has populated coverage.
- **AniList crowd recos** (`anilistCrowd` source): a SECOND crowd source alongside MAL's `crowd`, NOT a taste-profile source. `fetchAnilistRecommendations()` in [sync.ts](src/lib/providers/anilist/sync.ts) queries the `Media.recommendations` connection for the same seed set (`Page(perPage:50){ media(id_in:$ids){ id recommendations(sort:RATING_DESC, perPage:15){ edges{ node{ rating mediaRecommendation{ id idMal } } } } } }` — kept as its OWN query, not stacked on the tags+staff one, to stay under the complexity ceiling; verified live). **Each edge carries BOTH ids** (E11): selecting only `idMal` threw away AniList's own identifier for a title AniList had just handed us, which dropped every rec AniList couldn't map to MAL — exactly the AniList-only titles a keyless install exists to surface — and forced hydration to ask AniList *back* by MAL id. The refresh resolves each edge to a canonical id at ingest (AniList id first, MAL id second), so an AniList-only rec is now a first-class candidate. Unlike SIMKL, whose `users_recommendations` carry only a `simkl` id — which is why SIMKL crowd recos were NOT adopted. Fetched during `performRecommendationsRefresh` (after MAL suggestions), stored in `RecommendationsData.anilistSeeds` (parallel to `seeds`, keyed by seed canonical id; `num` = AniList net `rating`). In `computeFeed` it has its OWN accumulator + normalization denom (AniList `rating` ≠ MAL `num_recommendations`) and INJECTS new candidates like `crowd` does. Ships at weight `0` until a refresh populates it.

### Cast (characters + seiyuu) — a lazily-filled OFF-hot-path slice

The detail page's Cast section: each character paired with its Japanese voice
actor(s), from AniList. Storage is `catalog/anilist_cast.json` (`AniListCastEntry`,
keyed by canonical id) — **its own slice, deliberately NOT part of the seven-slice
join** in `getAnimeForDisplay()`, and the one AniList data set that works this way:

- **Why not on `AniListMetaEntry`.** Cast is display-only (it feeds no reco
  source, unlike `tags`/`staff`), and it's the bulkiest AniList payload there is
  (~25 characters × 2 portraits + 2 names per title — tens of MB catalog-wide,
  bigger than `catalog/mal.json`). `catalog/anilist.json` is parsed on every
  cold row build and the row cache keys on those seven slices' identity, so putting
  cast there would tax every row build for data one page reads. **That is a
  hot-path cost, not a migration cost** — moving the slice would be trivial and
  is not the objection; the per-request tax is. Hence
  `upsertAnilistCast` **does not invalidate the row cache** — a cast write cannot
  change any assembled row.
- **Filled lazily, one title at a time**, by `getOrFetchAnilistCast` in
  [src/lib/providers/anilist/cast.ts](src/lib/providers/anilist/cast.ts) (its own module — `providers/anilist/sync.ts`
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
  null-bomb caveat that forces `Page.media` in `providers/anilist/sync.ts` is a batching
  concern and doesn't apply. **Keyed on the AniList id alone** (E8); it took
  `idMal` OR `id` until then, which made this the one live `Media(idMal:)` query
  key outside the write path. A title with no AniList id is skipped by the sweep
  rather than bridged.
- **Never send an id as an explicit `null`.** AniList applies a supplied-but-null
  argument as a real filter (`id = null`), matching nothing and answering 404.
  This is not a hypothetical: the original two-variable code sent
  `{malId, anilistId: null}` on every call, so every fetch 404'd, was read as
  "AniList has no cast", and persisted an empty `characters: []` — permanently,
  since empties short-circuit. Verified live 2026-07-19 and fixed. The single
  variable makes the hazard unreachable here, but the rule holds wherever an
  AniList query takes an optional id.
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
  live: cut at 69/665, restart queued 596). Which makes running it a **normal
  step, not a last resort** — "this needs a full cast sweep afterwards" is a note
  in the plan, never a reason to avoid a change. Fire-and-forget + `appendLog(
  'anilist-cast-sweep', …)`, same idiom as meta-sync/catalog-crawl.
- **Japanese VAs only** (`voiceActors(language: JAPANESE)`) — these are seiyuu, not
  dub actors. **All** of a character's VAs render, not just the first: dual casting
  (a child self + an adult inner monologue) and mid-series recasts are common.
- **Seiyuu link to `/credits/seiyuu/[id]`, never to `/credits/staff/[id]`.** The
  two share an id space and nothing else: `listAnimeByStaff` scans
  `sources.anilist.staff`, the top-50 *production* credits, which by
  construction never contain voice actors — so a staff link would resolve to
  nothing. `seiyuu` is a third credit TYPE for exactly that reason, and it reads
  its own slice (see "Seiyuu filmography" below), not this one.

### Seiyuu filmography — the cast slice, inverted

`/credits/seiyuu/[id]` answers "what has this voice actor been in", which the
cast slice **cannot** answer and never could. [seiyuu.ts](src/lib/providers/anilist/seiyuu.ts)
fetches it from AniList by staff id into `catalog/anilist_seiyuu.json`.

- ⚠️ **Deriving a filmography from `catalog/anilist_cast.json` returns the titles
  you have already WATCHED.** That slice is keyed by title and filled per title —
  lazily on a detail-page view, plus the /stats sweep over the statused list — so
  the pool it draws from is your own list. Measured when this shipped: 715 cast
  entries out of 26,666 catalog titles, **689 of them statused**. So the page's
  `sans statut` filter was structurally guaranteed to return nothing, on every
  seiyuu, however many credits existed. Shion Wakayama: the scan found 29 credits,
  all 29 watched; AniList has 63, of which 30 are unwatched. Takahiro Sakurai: 66
  vs **622, 516 unwatched**. Do NOT "fix" this back into a cast-slice scan — the
  scan survives only as the stand-in rendered while the fetch is in flight.
- **`Staff.characterMedia`, one edge per CHARACTER**, so a recast or a twin
  arrives as several edges naming the same title and they are merged by media id.
  `perPage: 50` is silently capped at **25** (the same hard cap `sync.ts`
  documents for the `staff` connection), and ⚠️ `pageInfo.total`/`lastPage` report
  the same 500/20 placeholder on every page but the last — page on `hasNextPage`
  alone. There is no `type` argument on this connection (AniList answers
  `Unknown argument "type"`), so MANGA edges are filtered client-side; they are
  rare (500 edges → 487 anime on the sample).
- **Persisted, not process-cached**, unlike `/mix`'s per-anchor edge cache. Live
  timings: Shion Wakayama 3 pages / 4.5s, Youko Hikasa 528 credits / 44s,
  Takahiro Sakurai 622 credits / 53s at the shared ~2.1s throttle.
  `MAX_FILMOGRAPHY_PAGES = 30` (750 credits) clears the real tail; past it
  `complete: false` is declared rather than the truncation being silent.
- **Therefore NOT awaited in `getServerSideProps`.** A 50-second server render
  reads as a hang, so the page renders the cast-slice stand-in, fetches once on
  mount (the `CastSection` idiom), then `router.replace`s its own route so the
  normal server path resolves and filters the new slice. The endpoint returns no
  rows for that reason. Every later view is a plain local read.
- **Resolution is the ingest boundary** (E9): AniList media id first, `idMal`
  second, resolve-only. Both keys earn their place — Sakurai has 3 credits the
  local catalog lacks, and the `idMal` fallback is what resolves titles the
  registry holds no AniList id for. Unresolvable credits are **counted and
  stated**, never silently dropped.
- ⚠️ **A pending seiyuu must not 404.** Nothing local knows the person precisely
  when the cast slice has never covered them — which is exactly the case this
  feature exists for — so `getServerSideProps` renders a placeholder and lets the
  fetch run. 404 is still correct for a seiyuu already fetched and unknown.
- A transient AniList failure is **never persisted**: an empty entry
  short-circuits forever, same discipline as the cast slice's stored empties, so
  only a real "AniList has no such person" answer is written.

### Staff importance tiers — a lookup, not a data field

The detail page ranks `sources.anilist.staff` into four tiers via
[src/lib/domain/staffRole.ts](src/lib/domain/staffRole.ts) (`staffRoleTier`), because AniList's
RELEVANCE sort is only loosely importance-first and the flat list gave
`Episode Director (eps 8, 13, 20)` the same weight as `Director`. Full extraction
and the rejected alternatives are in docs/staffRoleTiers.md.

**Same shape as `genreAxis`, deliberately**: a pure function of the role string,
closed whitelists for T1/T2/T4 with an open **fall-through to T3**, so no new
catalog field, no precedence entry, no migration, and a misclassification is fixed
by editing an array. Live split: 298,362 credits → 16 / 23 / 32 / 30 %.

- **The qualifier rules carry more of the value than the whitelists.** 28,812
  distinct raw role strings collapse to 2,502 once trailing parentheticals are
  parsed off. `ADR *` or a dub-language qualifier → **T4 unconditionally** (~7% of
  all credits); an `ep`/`eps` qualifier **demotes exactly one tier** (not a floor —
  that keeps an anthology's per-segment directors visible in T2); `OP`/`ED` are
  **ignored** (15,486 instances — on `Theme Song Performance (ED)` the qualifier
  says *which song*).
- ⚠️ **The tier lookup trims in TWO places and neither is redundant.** The store
  holds `"Producer "` (770), `"Director "` (436) and `"Music "` (313) as distinct
  strings; matching unnormalized drops 1,549 credits out of T1/T2 into the
  fall-through — silently misfiled, the `GENRE_ALIASES` failure mode. That case
  is covered by **both** trims, which is exactly why each looks like dead code
  when removed alone. Each also guards a case only it reaches:
  `parseStaffRole`'s `raw.trim()` feeds a `$`-anchored peel regex, so whitespace
  *after* the closing paren stops the qualifier being peeled at all (141 credits);
  `key()`'s trim normalizes the parts `staffRoleTier` manufactures by splitting a
  qualifier on `;`, where the dub language may not be first — `(OP; English)`
  (37 credits). ⚠️ So a single trim at the function's entry cannot replace the
  pair: the split happens after it. All three cases are pinned individually in
  [tests/domain/staffRole.test.ts](tests/domain/staffRole.test.ts).
- **The producer/planning family is pinned to T3 as a group.** Left to the
  whitelists it scattered across three tiers; consolidating it cut JoJo Part 4's
  T2 from 18 rows to 11 of pure creative crew. `Animation Producer` stays in T2 —
  a creative anchor, not a committee seat.
- ⚠️ **T1 can be empty; the render must tolerate it.** 1,690 titles with staff
  carry no T1 credit (shorts, music videos, and anthologies where every `Director`
  is `(ep N)`). *JAA Meets Yokohama* genuinely credits 36 directors.
- **"N dans ta liste" counts T1 credits only, and the scoping is structural.**
  `buildStaffAffinity` counts the user's statused titles where a person holds a
  **T1** credit. Raw prolificacy measures the *role's* throughput, not the person
  (a 95th-percentile Sound Director holds 77 credits; a Chief Director, 6) — over
  T1+T2, 15 of the top 25 were sound directors and editors, so the mark would have
  read "98" beside Jin Aketagawa and "30" beside Sawano. T1-only excludes those
  roles by construction; **do not "improve" this with a within-role percentile**,
  which was measured and rejected (it marks 19 of 23 rows on Cowboy Bebop, and
  Watanabe fails the p99 Director cut while the pseudonym `Hajime Yatate` tops it).
- **The mark is sent only for titles with no effective status.** It fires on 56% of
  T1 rows on a watched title — its staff recur in your list by definition — versus
  15.8% on an unseen one, where it is a reason to watch. Index memoized on the row
  array's identity (the `byCredits` / `api/anime/genres` WeakMap trick).

### AniList OAuth (login tier: write-back)

AniList is a fourth **writable** personal provider, OAuth'd
(see docs/DECISIONS.md). Auth lives in
[src/lib/providers/anilist/auth.ts](src/lib/providers/anilist/auth.ts) (token store `auth/anilist.json`
+ the CSRF state + the viewer lookup — the transport itself is
`anilist/client.ts`, shared with the anonymous sweeps), the flow in
[src/pages/api/anime/anilist/auth.ts](src/pages/api/anime/anilist/auth.ts), and
writes in [src/lib/providers/anilist/write.ts](src/lib/providers/anilist/write.ts), registered as the
`anilist` entry in `providers/writers.ts`. Four things that differ from MAL/SIMKL:

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
same carve-out as MAL's writer. AniList sits **last** in personal precedence
even when OAuth'd — deliberate: it is first on *catalog* precedence but an
absent-tolerant refill pipe for *personal* state.

**The read half** is [src/lib/providers/anilist/personalSync.ts](src/lib/providers/anilist/personalSync.ts):
`importAnilistPersonalList()` pulls the OAuth'd viewer's OWN list by `userId`,
**private entries included**, in a single `MediaListCollection` call (it returns
the whole list — not a paginated connection — so no throttled batch loop), and
full-replaces `personal/anilist.json`. It is **authenticated-only** —
there is no anonymous read-by-username path. That is load-bearing rather than
merely a limitation: because every entry in the slice belongs to a connected
account, AniList participates in discrepancy detection with no actionability
gate.

### "Plus comme ça" — the single-target drill-down (detail page)

The detail page's second reco block ([MoreLikeThis.tsx](src/components/anime/MoreLikeThis.tsx)), backed by `GET /api/anime/recommendations/similar/[id]` and `computeSimilarTo` in [similar.ts](src/lib/reco/similar.ts). It flips the feed's question from "what fits my taste" to "what resembles THIS title", by running the **same weighted-source machinery** (`computeIdf` / `buildFieldProfile` / `fieldMatch` / `isPrematureSequel` / the additive `Σ weight · value` + `RecoContribution[]` breakdown) with **one anchor instead of the user's whole seed set**. Consequences, all deliberate:

- **The positive taste profiles are built from the target anime alone**, so a source scores "shares a *rare* genre/tag/studio/creator with this title". `suggestions` and `feedback` are user-global and have no per-title meaning, so `ANCHORED_WEIGHTS` forces them to `0`; `rejection` and `popularity` stay on (they hold for any candidate). ⚠️ `anchored.ts` calls `buildDiscriminativeProfiles` **without** a `liked` set, so the netting reference is the user's global likes: netting the dislikes against a one-title anchor profile would assert "this anchor's genres aren't rejections", which is not a claim about the user. Its positive profiles stay un-netted for the same reason — here they mean "shares a rare value with what you picked", not "fits your taste".
- **Candidate set = the target's crowd edges only** (MAL `fetchRecoEdges` ∪ AniList `fetchAnilistRecommendations`, fetched in parallel, each non-fatal with a per-source outcome in the response). That fetch-and-resolve orchestration lives in [similarFetch.ts](src/lib/reco/similarFetch.ts), not in the route — lifted out when the MCP `similar_to` tool needed the same thing, so the two callers cannot drift on which sources are asked or how edges are resolved. It is the **ingest boundary** (E9): each provider is asked with its OWN id and every edge is converted to a canonical id there, resolve-only. Metadata only *re-ranks* within that set, never injects — which is exactly what keeps this block distinct from the sibling **"Dans le même studio / staff"** block ([similarByCredits.ts](src/lib/reco/byCredits.ts)), a pure catalog-wide credit similarity computed in `getServerSideProps`.
- **Seen titles are NOT excluded** (unlike `computeFeed`). The pool is ≤ ~25 edges before filtering, so hard-dropping seen titles guts the block for a heavy watcher; they're returned with their effective `status` and marked "👁 Déjà vu". Still excluded: the target + its `related_anime`, hidden, 👎, premature sequels.
- **Stateless and hydration-free.** It never reads or writes `RecommendationsData`, and a crowd edge pointing at a title absent from the local catalog is simply skipped (no metadata to rank on) rather than triggering a MAL detail fetch.
- **Click-to-load**, because the detail page otherwise makes zero external calls and this block costs a MAL + an AniList round-trip.

**The ranking itself is not this module's** — it is [anchored.ts](src/lib/reco/anchored.ts)'s `computeAnchored`, which takes N anchors; `similar.ts` is the one-anchor caller plus the lean `SimilarItem` projection (`topSeeds`/`fromSuggestions` are meaningless with a single anchor, and the block only needs a poster card). `/mix` below is the other caller. Everything in the list above lives in `anchored.ts` except the seen-titles rule, which is the one genuinely per-surface choice (`excludeSeen`).

### "/mix" — recommendations from a hand-picked set

[/mix](src/pages/mix.tsx) is the **middle ground between the two reco surfaces**: "Plus comme ça" has one anchor and no choice (it is whatever title you are looking at), "Pour toi" has every high-scored completion and no choice either. Here the user picks the anchors — a search box adds titles, the feed re-ranks on every add/remove. Its own route with its own [useMixUrlState](src/hooks/useMixUrlState.ts) (anchors in the `a` key, so a mix is bookmarkable and the back button retraces the picks), composing the same sidebar sections + `AnimeListHeader` + `AnimeCardView` as `/recommendations`.

- **Same engine as the drill-down, N anchors instead of one** — `computeAnchored` pools every anchor's crowd edges and builds ONE taste profile from all of them. **Overlap is deliberately not a source of its own**: a title several anchors point at sums their backers into `crowd` and matches the pooled profile better, so it rises without a knob attached to nothing. The per-anchor split rides along in `recoMeta.topSeeds`, which is what makes the full-record card shape right here and the lean one right on the detail page.
- **Seen titles ARE excluded by default** (`excludeSeen`, toggle in the header), the opposite of the drill-down: the pool is N anchors wide, so it can afford it, and the question is what to watch *next*. `plan_to_watch` still counts as unseen.
- **The fetch is the route's half, and edges are cached per anchor** ([mix.ts](src/pages/api/anime/recommendations/mix.ts), process-lifetime, no TTL). The page refetches on every add/remove; without the cache, adding a 5th anchor would re-ask MAL about the other four. Crowd edges move on a scale of months, and only successful fetches are cached, so a dead source retries. MAL costs one request per anchor, AniList one for all of them (`id_in`) — cost scales with anchors *added*, not anchor count. `MAX_MIX_ANCHORS = 12` is a guard on that cost.
- **Weights resolve against `ANCHORED_WEIGHTS`, not `DEFAULT_WEIGHTS`** — client-side too, which is why that constant and `ANCHORED_SOURCES` live in the client-safe [weights.ts](src/lib/reco/weights.ts) rather than in `fs`-bound `anchored.ts`. `encodeSourceWeights`/`resolveWeights` take the base as a parameter so the `w` param stays sparse on both surfaces; `RecoWeightsSection` takes an optional `sources` list and renders only the anchored ones.
- **No 👍/👎 on the cards.** The thumbs reshape the *global* feed (they re-seed `refresh.ts`), which would be a surprising side effect of tuning a throwaway mix. 👎'd and hidden titles are still excluded, as everywhere.

### "/boxes" — « Mes boîtes », hand-drawn taste axes

[/boxes](src/pages/boxes/index.tsx) + [/boxes/[id]](src/pages/boxes/[id].tsx) over
`user/boxes.json`, with the store and both rankers in
[src/lib/reco/boxes.ts](src/lib/reco/boxes.ts). A box is a label the owner draws by hand
over their WATCHED list — "quand je suis fatigué", "pour l'animation", "concept bizarre".

- **Why it exists: the feed's positive signal is derived entirely from SCORES.** Every
  seed is a `completed` title scored >= 8, so nothing records *why* one was liked. The
  👍/👎 store was the earlier attempt and goes unused, correctly — it asks a
  **predictive** question ("will you like this unwatched title?"), which is the one thing
  the owner cannot answer. A box asks a **retrospective** one, against ~712 titles that
  can answer it. Do not read the thumbs' disuse as evidence that hand-labeling fails;
  it is evidence that PRE-WATCH labeling fails.
- **A box IS an anchor set, and that is the whole payoff.** `members` is a flat canonical-id
  array precisely so `computeAnchored` consumes it unmodified: `/api/anime/recommendations/mix`
  takes `box=<id>` alongside its own `ids=`, and the detail page's `recos` tab is `/mix`
  pointed at the box. `MAX_BOX_ANCHORS = 40` rather than `MAX_MIX_ANCHORS = 12` — `ids=` is
  arbitrary URL input, a box is a curated file, and the per-anchor edge cache makes MAL's
  one-request-per-anchor a once-per-process cost. Over the cap the highest-scored members win.
- ⚠️ **Franchise scope is `direct`, never `franchise`** — measured on the live store:
  712 statused titles collapse to **467** groups under sequel/prequel vs 447 under the wider
  scope, but the wider one chains Gundam SEED, 00, Iron-Blooded Orphans and Witch from Mercury
  into ONE **129-entry** component. It saves 20 decisions and costs a single chip click that
  files four unrelated shows. Same reasoning as `/catch-up`'s « suites directes ».
- ⚠️ **Membership persists as canonical ids, never a franchise key**, even though the UI writes
  a whole component per click. Components are derived from relation data that changes on every
  AniList sync, so a stored key would silently re-scope; ids also give the per-title override a
  recap movie or a comedy spin-off needs.
- **The grow ranker is metadata-only and touches no network** — `computeIdfSet` /
  `buildFieldProfile` / a floored `fieldMatch` over the owner's own statused list. Crowd edges
  are the WRONG signal here: they point at titles not yet seen, which is the opposite question.
  Two things it does NOT share with the feed, both measured with
  `node scripts/probe-box.js` (which reruns the whole thing, `--weights` / `--tagrank` to sweep):
  - **`BOX_WEIGHTS`, not `ANCHORED_WEIGHTS`.** The feed's weighting returned *Black Bullet*,
    *Freezing* and *Shield Hero* for an adventure box — every one a Kinema Citrus title, because
    Made in Abyss is. `studio` is near-binary, so `fieldMatch`'s divide-by-value-count makes a
    studio hit score ~1.0 against a tag hit's ~0.4, and studio/staff double-count the same
    evidence. Tags now lead (1.0), studio is demoted to 0.05. Fine for the feed, wrong for
    "is this the same KIND of thing" — a production house is not a kind of thing.
  - **`MATCH_DENOM_FLOOR` and `BOX_TAG_MIN_RANK = 60`.** Qualifying tags run p25 10 / median 14,
    but 24 of 712 titles carry fewer than four, so a title with ONE matching tag scored a perfect
    1.0 — *LONA* ranked #2 on `Female Protagonist` alone, ahead of *Girls' Last Tour*.
- ⚠️ **How well the grow loop works depends on the box, and that is the measured finding, not a
  defect.** A content axis projects beautifully (an "aventure exotique" box shares `Steampunk`
  5/6, `Lost Civilization` 5/6, `Aviation` 4/6 and proposes Girls' Last Tour, Sound of the Sky,
  **Mirai Shounen Conan**). A FORM axis does not: eight deliberately-weird titles shared only
  `Philosophy` and exactly **one** T1 credit, and the ranking drifted to Death Note and Monster.
  No catalog field encodes form. For those boxes the `recos` tab is the answer — the crowd graph
  encodes tone even though no field does. Neither tab is a fallback for the other.
- **Toggles, not drag-and-drop.** `/tier` drags because a score is EXCLUSIVE: one destination,
  and leaving the source is correct. A title belongs to any number of boxes, so a card must stay
  put, a source list that never shrinks shows no progress, and filing 467 groups across a few
  boxes would be ~1,100 drags. [BoxChips](src/components/anime/boxes/BoxChips.tsx) is one click
  per (group, box) pair. Writes are **incremental** (`add`/`remove`, never a full `members`
  replacement) because the grid fires many toggles against many boxes and a read-modify-write
  would let the second clobber the first.
- **Every box carries an emoji** (`DEFAULT_BOX_EMOJI` in `@/models/anime` — client-safe, because
  the create form is client-rendered and importing it from `reco/boxes` would pull `fs` into the
  browser bundle, which `src/pages/**` being exempt from the client-safety rule would NOT have
  caught). An iconless chip renders shorter than its neighbours, so a row stops lining up; the
  list projection falls back for older boxes and the detail page edits it in place.
- Routes: `boxes/index` (list + create), `boxes/[id]/index` (PATCH/PUT/DELETE),
  `boxes/[id]/grow`, `boxes/[id]/members`, plus
  [watched-groups](src/pages/api/anime/watched-groups.ts) for the labeling grid. The last one
  looks like `/quick-rate` and is not: that scopes the whole ~25k catalog and expands
  filter-matched SEEDS to their franchises, this scopes the watched list and lets the filters
  describe the rows themselves, because you can only box what you have seen. Both project through
  [domain/leanRow.ts](src/lib/domain/leanRow.ts) — one shared lean row, so neither API route has
  to import values out of the other (nothing in this repo does that; `stats.tsx` importing a
  *type* from its route is the whole precedent).

### Tier list rating board — a dedicated page that WRITES scores

A drag-and-drop rating surface at [src/pages/tier.tsx](src/pages/tier.tsx) (route `/tier`; note `/rate` is the unrelated Rating Calculator). Like `/recommendations` it's its own route with its own lean URL state ([useTierUrlState](src/hooks/useTierUrlState.ts)), **not** a third layout of the main list — it has editing semantics the main `AnimeFiltersState` shouldn't carry. Its sidebar is `RecoFiltersSection` and nothing else; every display control sits in `AnimeListHeader` (see below).

- **A tier IS a score.** Ten rows (10→1, colored green→red with MAL's word labels) plus an "à noter" tray (unrated). Dropping a card into a row sets that MAL/personal score; dropping into the tray clears it (score 0).
- **The rows have four possible meanings** (URL key `by`): `me` (my score — the original board and the **only writable axis**), `mal` / `anilist` (that provider's community mean, rounded to 1-10), and `gap` (my score *minus* the comparison provider's rounded mean, rows +5…−5, clamped with "or more"/"or less" end labels). Both switches — plus thumbnail size, an icon + `<select>` rather than a label and four buttons, since it is the bar's least-used group and a wrapping bar is the constraint — live in **`AnimeListHeader`**, the same bar `/` and `/recommendations` render, so all three pages read as one app; the tier sidebar is now filters and nothing else. That is the header's own split (*which* anime vs *how they look*), and it is also a discoverability fix: as a sidebar section under the filters they landed ~1100px down, below the scrolling genre list, where they were unfindable. A second key `vs` (`none`|`mal`|`anilist`) picks the comparison provider for the per-card gap chip; `gap` coerces `none` to `mal` rather than emptying the board, and suppresses the chip because the row already **is** the chip. Cards sort by gap descending inside a row whenever the chip is on, so contested titles cluster. `by !== 'me'` drops `draggable` and the drop handlers outright — a community mean and a difference are readings, not settings. Anything with no value on the active axis falls to the tray, which is relabelled accordingly (on `me` that's "unrated", on a provider axis "that provider has no mean").
- **The comparison reads RAW per-provider means, not `catalog.mean`.** `catalog.mean` is the precedence winner — one number, whichever provider won — so comparing against it would compare a title to itself whenever that provider won the field. `extractCatalogBySource(record.sources)` rebuilds each provider's own value (both already on MAL's 1-10 scale; AniList's `averageScore` is divided by 10 at hydration), memoized once per fetched list. ⚠️ **Expect the `mal`/`anilist` axes to look lopsided and that is the honest result** — community means cluster hard, live-measured 520 of 632 statused titles in rows 7-8 with rows 10 and 1-4 empty. That clustering is exactly why `gap` exists and is the more useful of the two.
- **Scope = the personal list, not the catalog.** Fetches `?status=watching,completed,on_hold,dropped&limit=all` (≈500 titles) — `plan_to_watch` is excluded (you can't rate what you haven't seen), which also means every card is already statused, so score writes never touch status. Splitting the *whole crawled catalog* (back to 1960) by score would be wrong. Cards are bucketed client-side by `getEffectiveScore`; all narrowing filters run client-side (via `applyNarrowingFilters`) so filtering never refetches.
- **Writes fan out to EVERY enabled provider**, not just MAL+SIMKL. The endpoint `POST /api/anime/animes/[id]/rating` ([rating.ts](src/pages/api/anime/animes/[id]/rating.ts)) is now a thin wrapper over `writePersonal` (see "Local personal-data provider" above), so it is the registry — not this route — that decides who gets written: every local-authority slice first (local-cache-authority; SIMKL-first `getEffectiveScore` means the local SIMKL bump is required for the drag to show through), then the enabled remotes serially. Since AniList OAuth landed that includes AniList. The original "both MAL and SIMKL" intent (keep them in sync, avoid a spurious discrepancy badge) is preserved as a *consequence* of fanning out to all writers, not as a hardcoded pair.
- **Remote-write failures are surfaced, not silent.** The endpoint returns the registry's per-provider `outcomes` map; the board shows a red badge on the card when a source didn't take. This matters because a SIMKL-first effective score would otherwise *hide* a failed SIMKL push (local MAL + local SIMKL already show the new value, so no discrepancy, and no sync corrects it). Both [tier.tsx](src/pages/tier.tsx) and `PersonalStateEditor` **iterate the outcomes map** rather than naming providers — hardcoding `mal`/`simkl` is what silently swallowed AniList failures once OAuth write-back shipped. `local` needs no filtering: its `writeRemote` is a no-op that always reports `ok`.
- **SIMKL ratings bucket = `shows` for anime** (live-verified 2026-07-05: a TV anime rating returned `201 added.shows:1`, empty `not_found`, `type:"show"` — score-only, status untouched). `pushSimklRating` still tries a bucket by `media_type` and self-corrects on `not_found` (kept as a safety net — anime *movies* under `media_type=movie` try `movies` first and are not yet live-verified). Every write is logged (`[simkl-rating]`).
- **Client write queue is serial** (`await` each before the next) — sidesteps SIMKL's 20s per-user write-lock and 1 req/s POST cap without batching. Optimistic move with revert-on-failure. Drag/drop is native HTML5 (zero-dep; score is the only persisted state, so within-row order doesn't matter). One shared hover-zoom preview element shows the large poster (not 500 large `<img>`s).

### "/catch-up" — the holes in franchises you finished something of

« À rattraper »: read-only, its own route + [useCatchUpUrlState](src/hooks/useCatchUpUrlState.ts),
backed by [api/anime/catch-up](src/pages/api/anime/catch-up.ts). The main list
cannot express it (a connected-component question, not a filter combination) and
`/quick-rate` reaches the same titles to *rate* them, not to ask what is left.

- **Two membership rules, and every other status is neither.** A franchise is in
  scope iff it holds an entry with effective status `completed` (the anchor —
  evidence you like the thing); a hole is an entry with **no effective status at
  all**. `watching`/`on_hold`/`dropped` are decisions in progress and
  `plan_to_watch` is a hole you already logged — listing them would make this a
  second view of the personal list instead of a view of what is absent from it.
- **The narrowing filters describe the HOLE, not the franchise** (the inverse of
  `/quick-rate`, where they pick seeds that expand). Search is the exception: you
  type a franchise name, so it matches any member and keeps the whole group.
- **« Suites directes » (`dr`) narrows the GRAPH, not the rows.** It re-walks the
  components over `DIRECT_RELATIONS` (sequel/prequel) instead of
  `FRANCHISE_RELATIONS`, so a side story stops being a *member* rather than being
  filtered out of one — which also severs the chain wherever a spin-off was the
  only thing joining two halves. That severing is the point: it is what stops the
  Steins;Gate group from dragging in ChäoS;HEAd, Robotics;Notes and ChäoS;Child.
  Live-measured, 659 holes → 172, and what survives is the actual continuations
  (Link Click *Season 2* + *Bridon Arc*, Haikyu's *Dumpster Battle*, Kaguya's
  *First Kiss That Never Ends*). `getFranchiseIndex` therefore caches **one index
  per scope** — the toggle flips between them on consecutive requests, and a
  single slot would make every flip a ~25k regroup. Note the edge classification
  is the providers' (overwhelmingly AniList's): an OVA they label `SEQUEL` stays,
  by design — this reads their vocabulary, it does not second-guess it.
- **A group is named after the first entry you COMPLETED**, not the component's
  earliest member. Live-measured, that is the difference between calling a
  franchise "Steins;Gate" and calling it "ChäoS;HEAd" — one graph, but you find
  it by the thing you actually watched.
- **`pv` and `cm` are never holes**, whatever the filters say. Only 9 rows of 668
  on the live store, so this is about not looking like noise — and it cannot be
  expressed as a filter, since `RecoFiltersSection`'s media-type list doesn't
  offer them (nor `tv_special`, which IS listed, deliberately).
- Unaired entries are hidden by default behind the `ua` key and **counted out
  rather than dropped** (`unairedHidden` per group), so "3 à rattraper" never
  quietly omits the sequel airing next season. Franchises sort by your best score
  on the anchor, descending: loved-but-unfinished first.
- Grouping goes through `getFranchiseIndex` in
  [domain/franchise.ts](src/lib/domain/franchise.ts) — shared with `/quick-rate`,
  memoized on the row array's identity.

### "/activity" — « Fil d'activité », the watch history

[/activity](src/pages/activity.tsx) over [api/anime/activity](src/pages/api/anime/activity.ts):
when you last watched each title, newest first, grouped by day. The main list
cannot express it — `watched_at` is not one of its sort columns and "group by
day" is not a filter combination.

- **SIMKL's `watched_at` is the ONLY usable clock, and this page is SIMKL-only
  as a result.** Re-measured on the live store when the page was built: SIMKL
  650/691; MAL's `updated_at` present on all 712 but spread over just 114
  distinct days with 183 sharing one (a bulk-sync artefact, not a history);
  AniList's import carries **no date field at all**; `LocalPersonalEntry.
  updated_at` is an edit mtime, a different question. Same finding the reco
  backtest harness rests on.
- ⚠️ **`watched_at` advances per EPISODE, not per completion** — the most recent
  rows are `watching` at partial progress, which is what makes this a feed
  rather than a completion log. It is also the ceiling: SIMKL gives exactly ONE
  timestamp per title, so the page can say "last watched Slime S4 at 19/24 on
  the 21st" and can never say which day episode 18 was. A real per-episode log
  needs SIMKL's activity endpoint captured on every sync — a different project.
- **`available: false` is its own render state**, distinct from "no results": on
  a MAL-only, AniList-only or keyless install the page says the store has no
  watch clock instead of looking broken. Measured **before** the filters, or a
  narrow filter would misreport a SIMKL install as having no history. Same
  declare-the-degraded-mode posture as `RecoRefreshSources` (B4). `undated` is
  reported next to the count for the same reason.
- **Days are grouped CLIENT-side.** `watched_at` is a UTC instant and only the
  browser knows the reader's timezone; grouping server-side would file a 23:30Z
  session under the wrong day for anyone east of Greenwich. The API returns a
  flat sorted list and the page cuts it into local days — so a day may straddle
  a page boundary, which merely repeats its header.
- **No sort key**, deliberately: the feed's order IS the clock, so a sort control
  would contradict the page — the same reasoning that keeps `sort` off
  `/recommendations`. `statuses` (`st`) is the one filter outside the shared
  narrowing set, because the feed mixes `completed`/`watching`/`dropped` by
  nature and "only what I finished" is the question most often asked of a
  history.
- **The SIMKL sync button lives here, not only on /connections**, because this
  is the one page whose freshness depends entirely on that delta. Gated on
  `byId.simkl?.connected` — token presence, the same predicate the write path
  uses, so the button cannot disagree with what the sync will do. It bumps a
  `reloadToken` rather than touching the filters; the delta rewrites
  `personal/simkl.json`, whose mtime invalidates the row cache, so the refetch
  sees the new dates (live-verified: a sync returning "3 updated" moved the top
  row and opened a new "Aujourd'hui" group).

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
- **A score range narrows it further** (`smin`/`smax` URL keys → `minMyScore` /
  `maxMyScore` on `ComputeStatsOptions` and on the `my_stats` MCP tool), because
  the flat ranking measures **volume**, which tracks how much of a genre exists
  as much as it tracks taste. Live-measured on the statused list: Action leads at
  55.9% overall but Drama overtakes it inside the 9-10 band (54.7% vs 51.8%), and
  Comedy leads the ≤5 band — the divergence is the whole point of the control.
  Bounds are on the **owner's own** score, hence not named `minScore`/`maxScore`
  like `NarrowingFilters`' community-mean bounds. **Either bound present drops
  UNRATED titles**: "what are my 9s made of" is a question about scored titles.
  The two `<select>`s clamp each other rather than letting an inverted range
  blank the page.
- **Aggregation counts DISTINCT anime, never credits** — a seiyuu voicing three
  characters in one show counts once. Multi-valued dimensions sum past 100% on
  purpose (a title has many genres); the percentage reads "X% of your list
  features this", denominator = filtered title count.
- **Computed server-side** ([api/anime/stats.ts](src/pages/api/anime/stats.ts) over
  the pure [src/lib/domain/stats.ts](src/lib/domain/stats.ts)), same reasoning as `/quick-rate`:
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

### "/graph" — an ego explorer, not a catalog map

[/graph](src/pages/graph.tsx) over [api/anime/graph](src/pages/api/anime/graph.ts), pure logic in
[animeGraph.ts](src/lib/domain/animeGraph.ts) + [graphLayout.ts](src/lib/domain/graphLayout.ts).
One focal node, its direct neighbours, and **re-centring as the only expansion**.

- **The whole-catalog graph does not exist and must not be materialized.** Measured: "two anime
  share a voice actor" is **82,196 edges over just 674 cast-swept titles**; tags are 419 nodes
  each touching hundreds; staff is 298,362 credits. No layout renders that — it is a grey disc.
  An ego turns that latent density into the asset (a seiyuu ego is ~10 anime, an anime ego ~40
  people). Tags are a *filter* on that ego, which is what they are actually good for.
- **Nodes are anime, NOT franchises** — asked and measured, because collapsing looks tempting on
  a prolific seiyuu (Nobuhiko Okamoto: 64 titles → 36 franchises). It loses coherence (median
  voice-cast Jaccard **0.30** between two members of the same franchise over 532 pairs;
  `FRANCHISE_RELATIONS` chains Gundam SEED, 00, Iron-Blooded Orphans and Witch from Mercury into
  ONE 128-member component whose casts are disjoint), erases the **147 characters recast across
  their own franchise** — exactly what a connection chart should reveal — and does not even solve
  the problem it was reached for, since 36 nodes is no more drawable in one radial ego than 64.
  Franchise survives as a *clustering hint* (`franchiseKey` on an anime node), grouping siblings
  into one expandable arc segment while keeping every node's identity, so a recast still renders
  as two edges to two characters.
- **Three focal types** (`anime` | `seiyuu` | `staff`), deliberately. `studio` and `character` are
  reachable as neighbours and link out, but neither makes a useful centre — a studio ego is a
  filtered catalog list (which `/credits/studio/[name]` already is), and a character's
  neighbourhood is one anime plus one seiyuu.
- **Layout is deterministic sectors, not a force simulation** — the target is a 4K TV at 300% zoom
  (~1280 CSS px) where the binding constraint is **label collision, not node count**. A simulation
  reflows on every interaction, so the same graph never looks the same twice and a screenshot
  can't be compared to the last one; it would also be the app's first layout dependency, in a repo
  that hand-rolled `/tier`'s drag-and-drop to avoid exactly that. Each group owns an angular wedge,
  so label space is *allocated* rather than negotiated, and a dense group grows outward into extra
  rings instead of crowding its neighbours. `MAX_NODES_PER_GROUP = 24` per arc; groups report
  `total` so the overflow is **stated, never silently dropped**.
- **Computed server-side**, for the `/stats` and `/quick-rate` reason only more so: the reverse
  indexes span the whole catalog (49,897 staff people, 2,255 seiyuu) and never cross the wire —
  one neighbourhood of a few hundred lean nodes does. The cast slice is read separately, since it
  is deliberately not in `getAnimeForDisplay()`'s join. **Nothing here calls a provider**; the
  graph is entirely a read of the local store, which is what makes it browsable at page speed.
- **`GraphCoverage` is the honesty block.** Seiyuu edges come from the lazily-filled cast slice, so
  `focalCastMissing` distinguishes "this title has a thin neighbourhood" from "the sweep has not
  reached it" — the same declare-the-degraded-mode posture as `RecoRefreshSources` (B4) and
  `/activity`'s `available: false`.

### "/connections" — split by ROLE, one card shape per provider

[src/pages/connections.tsx](src/pages/connections.tsx) is two groups — **Catalogue** and **Mes listes** — each mapping `providersWithRole(role)` over a single [ProviderCard](src/components/anime/connections/ProviderCard.tsx) (E1–E4 — docs/DECISIONS.md). It replaced four hardcoded provider-named sections plus a 24-prop `DataSyncSection` catch-all.

- **A card is a (provider, role) pair, not a provider.** MAL and AniList render twice, and **the auth kind is read from the role** — which is the point: AniList's catalog card says "aucun compte requis" (its metadata sync and bulk crawl are anonymous) while its list card asks for OAuth. Filing the two together is what made an unauthenticated action look like it needed a login. A dual-role provider shows its account control in the **personal** group only; the catalog card states the requirement and points at it.
- **Status comes from `GET /api/anime/providers`** via [useProviderStatuses](src/hooks/useProviderStatuses.ts) — the *only* client reader, shared with the header badges. `connected` is token **presence** (same predicate as `isPersonalProviderEnabled`, so a badge cannot disagree with the write path); `tokenValid` is separate, and `connected && !tokenValid` renders as an amber "session expirée" rather than as "not connected".
- **The header badges are one component** ([ConnectionBadges](src/components/anime/ConnectionBadges.tsx)) over that one fetch, replacing three near-identical stateful wrappers. `local` gets a badge **only while enabled** — an off local provider is not a connection.
- **`local` has a card**: active/inactive, entry count, precedence rank, why `auto` switched it off, and a link to `/settings`. On a keyless install it is the only active personal provider, and it previously appeared nowhere in the UI.
- **Actions are NOT abstracted.** Each provider's sync stays its own block in [CatalogRoleActions](src/components/anime/connections/CatalogRoleActions.tsx) / [PersonalRoleActions](src/components/anime/connections/PersonalRoleActions.tsx), passed to the card as children — MAL's seasonal crawl, SIMKL's delta and AniList's GraphQL batch are different operations (docs/DECISIONS.md). Only the card around them is uniform. Note MAL's list sync is a *personal*-role action while big-sync/historical-crawl are *catalog* ones; the sync-error state is split the same way.

### MCP — the store as a read-only tool surface

`POST /api/anime/mcp` ([mcp.ts](src/pages/api/anime/mcp.ts)) exposes the local record to an MCP
client (`claude mcp add --transport http anime-tracker http://<host>:12350/api/anime/mcp`). Twelve
tools, in [mcp/server.ts](src/lib/mcp/server.ts) (schemas) over [mcp/tools.ts](src/lib/mcp/tools.ts)
(handlers): `search_anime`, `get_anime`, `list_anime`, `list_genres`, `my_stats`, `recommend`,
`similar_to`, `tier_list`, plus the four box tools — `list_boxes`, `box_candidates`, `create_box`,
`edit_box`.

- **Read-only about the RECORD, enforced — with exactly one carve-out: boxes.** A *second* `files`
  block in [eslint.config.mjs](eslint.config.mjs) fails the build when anything under
  `src/lib/mcp/**` or `api/anime/mcp.ts` imports a write path — the same posture as the
  client-safety guard below, not a convention. **Ratings, statuses, hides and syncs stay
  unreachable**, and that is the point rather than caution: the owner's score is the ground truth
  every ranking here is measured against (`scripts/backtest-reco.js` grades the engine on exactly
  those labels), so a model writing one would be marking its own homework.
- **Boxes are the exception, opened deliberately.** `@/lib/reco/boxes` is importable because a box
  is a *judgement the owner is trying to articulate*, and "what do these eight shows have in
  common" is the thing a model is genuinely good at — measurably better than `rankBoxCandidates`,
  which cannot see a form or tone axis at all. ⚠️ **`deleteBox` is still blocked by name**, via an
  `importNames` entry rather than the blanket pattern: filling a box wrong costs a few chip clicks
  to undo, but dropping one throws away labeling that exists in exactly one place and that no
  provider can re-supply. Keep any future carve-out this shape — a named exception with a stated
  reason, never widening the pattern list.
- **The tools are thin adapters over the existing domain functions**, never a second
  implementation: `searchCatalog`, `computeStats`, `computeFeed`, `loadSimilarTo`,
  `applyNarrowingFilters`, `sortAnimeRecords`, `tierGap.ts`. A tool needing new behaviour gets it
  in `domain/` or `reco/`, where the pages can reach it too.
- **The binding constraint is TOKENS, not bytes** — a tool result is text in a model's context
  window. [mcp/project.ts](src/lib/mcp/project.ts) is the projection layer, and it never emits
  `sources`, `provenance` or `pictures`: that is the bulk of a record and none of it means anything
  to a model. Same server-side-projection posture as `/api/anime/quick-rate` and
  `/api/anime/catch-up`, only stricter. ⚠️ The `jsonStore` shared-reference contract applies —
  every projector BUILDS a new object and must never trim a record in place.
- **A fresh server per request** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`)
  costs nothing: the expensive state is the module-level parse cache and row cache, which survive.
  ⚠️ Next's `bodyParser` stays **ON** — the parsed body is `handleRequest`'s third argument, so the
  streaming-route reflex of disabling it (as `mal/big-sync.ts` does) makes every call hang.
  Unauthenticated like every other route here, riding the same LAN boundary.
- **`similar_to` is the one tool that reaches the network** (MAL + AniList crowd edges, via
  [similarFetch.ts](src/lib/reco/similarFetch.ts)); every other tool is a pure store read. The
  memoize-on-row-array-identity trick is reused for its relation index and id map.
- ⚠️ **A tool description is part of the contract, not decoration.** Both wrong claims in the
  external audit (docs/audits/recommend-algo-notes.md) came from what this surface *showed*, not
  from the reader — which is why `projectWhy` now trims per sign, `recommend` states that negative
  contributions are model output, and `tier_list` spells out its filter asymmetry. Treat a
  misleading description as a bug of the same weight as a scoring bug. The box tools are
  written to that standard: `box_candidates` states in its own description that its ranking
  drifts on a tone axis and names the measurement, because a confident-looking ordering is
  exactly what a model would otherwise trust; `edit_box` says to CHECK `rejected`, since an
  unresolvable id comes back there rather than failing the call.

### Scheduled sync (cron-sync) — nine steps, none of them a gate

[cronSync.ts](src/lib/providers/cronSync.ts) is the one place scheduled work
is orchestrated, and since F1 it covers every provider, not
just MAL. It is **not** a generic loop (docs/DECISIONS.md): MAL's
seasonal crawl, SIMKL's two-phase delta and AniList's GraphQL batch are
genuinely different operations. What is uniform is *enablement* and *reporting*.

- **It is a lib module, not a route, because it has TWO entry points**:
  [api/anime/cron-sync](src/pages/api/anime/cron-sync.ts) (the NAS cron job,
  secret-authenticated) and [api/anime/sync-now](src/pages/api/anime/sync-now.ts)
  (the "Tout synchroniser" button at the top of `/connections`, ungated and
  fire-and-forget). Both are thin — the secret check and the response shape are
  all that differ. The rejected alternative was having the button fetch the cron
  route over localhost with the secret attached, `startBigSync`-style: that
  reintroduces a secret matched in two places plus a hardcoded `localhost:3000`.
  `startBigSync` keeps its hop because *that* route owns a run lock and an SSE
  stream; this orchestration owned nothing that couldn't move.
- **`runCronSync` holds the run lock itself**, not the routes — a per-route check
  lets the button and the 02:00 tick each pass their own and double every step.
  ⚠️ The lock covers the *orchestration*, not the whole run: `syncMal` starts
  big-sync over HTTP and returns immediately, and the last two steps are
  fire-and-forget by design; those three are serialized by their own locks.
- **The button is ungated for a NARROWER reason than the other Connections
  buttons.** meta-sync / catalog-crawl / catalog-sweep are ungated because
  AniList's catalog role is `anonymous` (E4). That does not carry here —
  `runCronSync` includes `anilistPush`, a provider *write*. It is ungated because
  pressing it *is* the user-initiated authorization on a single-user LAN app.
  Don't generalize either reason onto the other set of routes.

- **Nine steps, each isolated and non-fatal**: MAL catalog (big-sync via HTTP,
  which owns the run lock, then a 5-season historical crawl), SIMKL delta,
  AniList list import, the **AniList push** (`anilistPush`), the AniList season
  crawl (`anilistDiscovery`), the AniList back-catalog crawl
  (`anilistHistorical`, 3 years a tick), the recommendations refresh, then the
  AniList metadata sync and catalog sweep.
  Each returns a `CronStepOutcome` and they are all echoed in the response
  — same "declare the degraded mode" shape as `RecoRefreshSources` (B4).
  `skipped: true` = not applicable (no account); `ok: false` = it should have run
  and didn't. **The handler answers 200 even when a step failed** — a non-2xx
  would tell the NAS cron job "nothing ran", which is exactly what F1 removed.
- ⚠️ **The 405 and 401 guards LOG before returning, and must keep doing so.**
  They are the only exits that produce no run at all, so a silent one is
  indistinguishable from a cron job that was never scheduled. Live case
  (2026-08-06): a `cronSecret` saved via `/settings` silently outranked the
  `CRON_SECRET` env var the compose cron container still sent — `resolveSetting`
  reads **stored before env** — so every 02:00 call 401'd for 11 days with
  nothing in `logs/connection_log.json`, the one log the Connections panel polls.
  Symptom was AniList progress frozen while MAL/SIMKL advanced, because
  `anilistPush` only ever runs from here. **The secret lives in two places by
  construction** (settings.json and the container env); `docker-compose.yml`
  substitutes `${CRON_SECRET}` into BOTH services so they cannot drift, but a
  stored `settings.json` value still wins over it and must be kept in sync or
  removed. Never log either value — only whether a header arrived.
- ⚠️ **The secret never goes into a `printf` format string, and never into the
  crontab.** The cron container writes it to `/run/cron_secret` with
  `printf '%s' "$CRON_SECRET"` — value as an **argument** — and the job reads it
  back with `$(cat …)`. Live case (2026-08-24): the old compose baked
  `${CRON_SECRET}` into printf's *format*, a metacharacter in the value
  truncated the output mid-quote, and `/etc/crontabs/root` ended up holding
  `… -H "Authorization: Bearer X2`. crond then ran `sh -c` on that every night —
  `/bin/sh: syntax error: unterminated quoted string`, nothing reaching the app,
  so **not even the 401 path above logged**: `connection_log.json` simply stops.
  That silence is the signature of a request that never arrived, as opposed to
  one that was rejected. Don't reintroduce a "keep the secret alphanumeric" rule
  in place of the `%s` argument — the rule is what failed.
- **The freshness indicator on `/connections` is the answer to both of those**,
  and it exists because both outages were **absences**: the 401 logged errors
  nobody was looking for, and the `printf` truncation logged *nothing at all*.
  A watermark (`sync/cron_health.json`, written by
  [providers/cronHealth.ts](src/lib/providers/cronHealth.ts)) is read by the pure
  [domain/cronFreshness.ts](src/lib/domain/cronFreshness.ts) and rendered in
  `SyncNowPanel`. It rides on `GET /api/anime/sync-now`, which the page already
  polls for the run lock, so it costs no extra request.
  ⚠️ **It is NOT derived from `logs/connection_log.json`** — that is a 500-entry
  rolling buffer shared by every channel (`anilist/sync.ts` alone has 39
  `appendLog` sites), so a busy day evicts a whole run and "scrolled out of the
  buffer" would be indistinguishable from "never happened", which is the exact
  distinction this has to make.
  ⚠️ **A manual "Tout synchroniser" never counts.** `runCronSync` takes a
  required `trigger`, and the manual run is recorded under its own key and
  reported but excluded from the verdict — otherwise the first thing anyone does
  while investigating a dead cron would turn the light green.
  ⚠️ **Arrival is stamped by the ROUTE, before `runCronSync`**, which separates
  the two silences (nothing arriving = crontab/container; arriving but never
  completing = a hung run) and stops a lock collision from crying wolf: a tick
  landing during a manual run returns immediately and completes nothing. `ok` is
  therefore decided before `stalled`. Levels are `ok`/`rejected`/`stalled`/
  `silent`/`unknown` — each a different FIX, with degradation carried as
  `failedSteps` rather than a sixth level. `unknown` is deliberately not an alarm:
  the watermark is empty until the first tick after this shipped.
- **`anilistPush` is the one step that WRITES**, and the only provider write in
  this app outside a user-initiated edit. `writers.ts` already mirrors every edit
  made *here* to AniList; this step exists for the edits that never pass through
  it — **a rating made directly on the SIMKL website**, which arrives via the
  SIMKL delta and would otherwise leave AniList drifting until someone pressed
  the Connections button. It runs after the SIMKL delta (which lands the
  ratings) and after the AniList import, whose **full-replace** write would
  otherwise clobber the slice updates `performAnilistPersonalPush` makes as it
  goes. Awaited and uncapped, unlike the two fire-and-forget sweeps: it diffs
  against a fresh remote read and pushes only what differs, so a converged
  install spends **one GraphQL request per tick and writes nothing**. Only the
  first run is long, and it is resumable by construction.
- **No provider gates the run.** Until F1 a missing or expired MAL token was a
  400 for the whole handler, so a SIMKL-only, AniList-only or keyless install got
  nothing at all — including the recommendations refresh, which B4 had already
  made MAL-optional. Each personal step now guards itself with the one enablement
  predicate, `isPersonalProviderEnabled(id)`.
- **The three AniList catalog steps are ungated on purpose** — that role's auth
  kind is `anonymous`, so they run on an install with no account of any kind.
  Gating them on the AniList *account* is E4's mistake in orchestration form.
- **`anilistDiscovery` exists because of E8.** Now that AniList is queried only
  by AniList ids, a title enters the enrichment queue only once its AniList id is
  in the crosswalk, and the only thing that puts it there is an AniList-native
  call returning `id` alongside `idMal`. Without a recurring crawl, every title
  MAL's seasonal sync adds from here on would be permanently invisible to AniList
  enrichment — the MAL-id bridge used to paper over that. Bounded on purpose:
  the current season, ≤8 pages, early-exit on `hasNextPage`.
- **Depth is `anilistHistorical`'s job, and it is a THIRD crawl with its own
  query.** `performAnilistHistoricalCrawl` walks the back catalog **by year, on
  `startDate_greater`/`_lesser`**, checkpointed per year in
  `sync/anilist_years.json`, paging each year to exhaustion (cron takes 3 years a
  tick; the Connections button runs it uncapped, ~12 min for the whole
  2017→1960 window). Two traps it exists to avoid, both live-measured:
  **`season` is null on 23-45% of pre-2018 titles**, so no depth of season-keyed
  sweep can reach them — hence the date range; and `startDate_greater` is
  strict while fuzzy dates store as `YYYY0000`, so the lower bound must be
  `YYYY0000 - 1` or every month-unknown title is dropped (28 of 1998's 234).
  ⚠️ **It does NOT close the ~24% of the registry holding no AniList id, and
  nothing will**: a full run moved that gap by zero, and 30 sampled gap titles
  returned 0 hits when asked for individually — they are recaps, specials, PVs,
  CMs, music videos and CN/KR web animation that MAL lists standalone and
  AniList does not carry. It earns its place by adding titles AniList *does*
  have (1,693 on the first run, 572 of them with no MAL id anywhere).
- **Order is load-bearing.** Data pulls first, so the reco refresh consumes what
  they just landed (measured: 4 seeds keyless vs 274 after the SIMKL + AniList
  imports on the same store). `anilistDiscovery` is **awaited**, before the
  sweeps, precisely so they see the ids it lands. The AniList metadata sweep and
  catalog sweep go **last** and fire-and-forget: they are incremental but
  unbounded, awaiting them would put the next tick's SIMKL delta behind them, and
  they throttle against the same AniList rate limit the reco refresh just used.
  `isAnilistMetaSyncRunning()` is what lets a fire-and-forget step still report
  "already running" honestly.

### Header navigation — two arrays, and the "others" list is DERIVED

[Layout.tsx](src/components/Layout.tsx) drives the whole bar from `PRIMARY_NAV`
and `OTHER_NAV`, rather than a hand-written `<Link>` per entry as before.

- **The bar carries only the four daily surfaces** — `/`, `/recommendations`,
  `/tier`, `/activity` — with everything else under "Autres". The target is a
  4K TV at 300% zoom (~1280 CSS px), where the previous seven-item bar plus the
  language toggle and three connection badges wrapped onto three lines;
  measured, the reorganised bar is one 26px row.
- ⚠️ **`OTHER_ROUTES` is `OTHER_NAV.map(i => i.href)`, never a literal.** It
  decides whether the dropdown trigger highlights, and as a separately
  maintained list it had already drifted: `/graph` and `/precedence` were in the
  menu but absent from the list, so the parent read as inactive on both pages.
  Deriving it makes that unrepresentable — adding a menu entry cannot forget it.
- **`/connections` sits in the dropdown**, which costs nothing because the three
  connection badges to the right of the bar are themselves links to it. The
  badges are the permanent entry point; the menu item is the discoverable one.
- **The dropdown is grouped, and every entry carries an emoji.** At ten entries
  a flat list stopped being scannable, so `OTHER_NAV_GROUPS` splits it by what
  you are trying to do — *Explorer* (the three surfaces that were top-level
  until the bar was trimmed), *Analyse* (read-only), *Sources & données* (the
  providers and the data itself), then Settings alone and unlabelled at the
  foot, where every application puts it. Groups are separated by a top border on
  the group rather than an `<hr>`, so the first one needs no special case.
  ⚠️ An earlier pass left the diagnostic entries **without** icons on purpose,
  so the split would read at a glance; the group headings now do that job
  properly, and a menu where two thirds of the rows have an icon looked
  unfinished. Adding an entry means adding an icon in BOTH locale files.

### First-run onboarding (empty store)

When the store is **genuinely empty**, `index.tsx` renders [FirstRunOnboarding](src/components/anime/FirstRunOnboarding.tsx) instead of the list: the resolved data folder (from `GET /api/anime/settings`), a link to `/settings`, and a button that seeds the catalog from AniList with a live progress bar.

- **The gate is the registry count**, not the filtered list length: a mount-time `GET /api/anime/anilist/catalog-crawl` returns `totalCanonicalIds` (0 = empty) — so a filter combination that hides everything never false-positives into onboarding. The same response's `crawlRunning` lets a mid-crawl page reload resume the progress view.
- **The button fires the bulk crawl** — `POST /api/anime/anilist/catalog-crawl` with `{scope: 'bulk'}` → `performAnilistBulkCatalogCrawl` in [anilistSync.ts](src/lib/providers/anilist/sync.ts): seasons newest-first from the NEXT season back 8 years (~36 seasons × ≤3 pages × 50 titles, mirroring MAL big-sync's window), **persisting after every season** (a mid-crawl failure keeps everything already fetched; one bad season is non-fatal and logged at `info` level — an `error`-level entry is the onboarding's fatal signal). Shares the run lock and the `anilist-catalog-crawl` log channel with the single-season crawl (which stays wired to the Connections page).
- **Progress = polling `GET /api/anime/connection-log`** for the per-season entries' `{seasonIndex, totalSeasons}` detail (no SSE — same pattern as the connections log panel). The panel snapshots the log head id before starting so stale entries from an earlier crawl (LOGS_PATH survives a data reset) are never misread as ours. On the `success` entry it flips back to the list; newest-first crawling means the default preset (current-season TV) has rows immediately.

### i18n (FR/EN, localStorage-backed)

A lightweight, dependency-free i18n built for GitHub visibility (the app is single-user, so path-based locale routing / SEO buy nothing and would fight the "URL is source of truth" + single-page architecture). Lives in [src/lib/i18n.tsx](src/lib/i18n.tsx); strings in [src/locales/fr.json](src/locales/fr.json) + [src/locales/en.json](src/locales/en.json) (flat dotted keys).

- **`fr` is the canonical key set.** `TranslationKey = keyof typeof fr`, and `DICTS` is typed `Record<Lang, Record<TranslationKey, string>>` so a key present in `fr.json` but missing from `en.json` is a **compile error**. A contributor adds a language by copying a JSON file and registering it in `DICTS`.
- **Active language lives in `localStorage`** (`anime-app.lang`), not the URL. To stay hydration-safe, the **server and first client render always use `DEFAULT_LANG` (`fr`)**; `I18nProvider`'s mount effect then reads `localStorage` and swaps. So EN only ever appears after client hydration — SSR HTML is always FR. `LanguageToggle` (in [Layout.tsx](src/components/Layout.tsx)) flips + persists.
- **Client usage:** `useT()` → `t(key, params?)`; `{name}` placeholders interpolate via the `params` object. **Dynamic keys** built from stable data ids use a cast: `` t(`statusShort.${status}` as TranslationKey) `` — the cast **bypasses the missing-key compile check**, so those families (`airing.*`, `seasonName.*`, `status.*`/`statusShort.*`, `field.*`, `reco.source.*`, `reco.preset.*`, `views.*`, `tierWord.*`, `tierGap.*`, `tier.axis.*`, `tier.vs.*`, `detail.staffTier.*`) must be kept exhaustive by hand. **That is now enforced** by [tests/i18n/dynamicKeys.test.ts](tests/i18n/dynamicKeys.test.ts), which drives each family from the id source its call site uses — an exported constant where one exists, otherwise a `satisfies Record<Union, 0>` literal, so growing the union is a compile error in the test until the key is added. Two caveats worth knowing before trusting it: `airing.*` is transcribed rather than derived (MAL types `airingStatus` as a bare `string`, so there is no union to grow), and `detail.staffTier.*` is asserted for **T2/T3 only** because the family is partial by design — T1 has its own heading and T4 folds into `detail.staffTierMore`, which is exactly why `/graph` gave itself a complete `graph.tier.*` set instead of reusing it. Whole-dictionary invariants the typing cannot see — orphaned `en` keys, empty strings, `{placeholder}` drift between languages, and the nav-emoji rule — are in [tests/i18n/locales.test.ts](tests/i18n/locales.test.ts). The shared data files (`reco/weights.ts` `SOURCE_META`, `url/animeParams.ts` `VIEW_PRESETS`) are **not** translated — keys are derived from their stable `source`/`key` fields in the rendering components, keeping those modules server-safe.
- **Server usage:** `translate(lang, key, params?)` / `makeT(lang)` are framework-free (no React context) for the reco **"Pourquoi ?"** detail strings built in [feed.ts](src/lib/reco/feed.ts) / [similar.ts](src/lib/reco/similar.ts) (`computeFeed` / `computeSimilarTo` take a `lang`, keyed `recoDetail.*`). The client passes `?lang=` to `/api/anime/recommendations` and `…/similar/[id]`; both default to `fr`.
- **Deliberately left French-only:** the `/rate` rubric ([ratingGrids.ts](src/lib/domain/ratingGrids.ts), subjective prose) — only the calculator's chrome is translated. `formatUserStatus` is still used for the catalog `source` field (language-neutral prettify), not for watch statuses.

### Title language — a display preference that is ALSO read server-side

Which of a title's three names shows as the primary one: `english`
(`alternativeTitles.en`), `romaji` (`catalog.title` — MAL's and AniList's own
default) or `native` (`alternativeTitles.ja`). The vocabulary is AniList's
`userPreferredTitleLanguage`, because that is the wording the owner already
meets on the site most of these titles come from.

- **It is a `ViewDefaults` key, not a new settings field.** `titleLanguage` sits
  in [src/lib/url/viewDefaults.ts](src/lib/url/viewDefaults.ts) beside
  `cardsPerRow`/`sidebarExpanded` — "how it looks", never URL state — so it
  inherits that module's whole apparatus for free: sparse storage under
  `settings.json.viewDefaults`, `resolveViewDefaults`/`sparseViewDefaults`
  sanitizing and no-op-dropping it, `GET/POST /api/anime/view-defaults` as the
  transport, and `useViewDefaults`'s **one module-level store, one fetch per
  page** on the client. Adding it as a top-level `AppSettings` field would have
  meant a second endpoint and a second client cache for the same kind of value.
- ⚠️ **Not the FR/EN UI language, and the two must never be merged.** The UI
  language is `lib/i18n.tsx`, `localStorage`-backed, per-browser, threaded as
  `lang`. This one is stored server-side and also decides what several endpoints
  put in a `title` **field**. English UI + Japanese titles is a legitimate
  combination. `computeFeed`/`computeSimilarTo`/`computeAnchored` now take BOTH,
  as `lang` and `titleLang` — do not collapse them.
- **The preference reaches the render two ways, and which one is correct depends
  on where the page gets its data.** Client-fetched pages (`/`, `/tier`,
  `/discrepancies`, `/recommendations`, `/mix`) read `useTitleLanguage()` — they
  already render an empty grid until their own fetch lands, so the preference
  arrives with the rows and there is nothing to flicker. SSR pages
  (`/anime/[id]`, `/credits/[type]/[id]`) take it as a **prop** resolved by
  `getTitleLanguage()` in `getServerSideProps`, because the hook's pre-fetch
  value is `SHIPPED_TITLE_LANGUAGE` and using it there would paint an English
  headline title and then swap it.
- **`getTitleLanguage()` (in `config/settings.ts`) is server-only, which is why
  the helpers take a parameter at all.** `getPrimaryTitle`/`getSecondaryTitle`/
  `getCatalogPrimaryTitle` live in `lib/domain/animeUtils.ts`, and that folder —
  along with `lib/reco/byCredits.ts` — is in the enforced client-safety eslint
  block, so it cannot read the setting itself. Server callers pass it down; the
  outermost boundary (API route, `getServerSideProps`, MCP handler) is where
  `getTitleLanguage()` is actually called.
- ⚠️ **The `pref` parameter defaults to `SHIPPED_TITLE_LANGUAGE`, and that
  default means "not yet threaded", never "deliberately English".** It exists so
  that ~47 call sites could be converted without a flag day. A new call site
  that omits it is a bug that will not announce itself — pass the preference.
- **Three places read a title WITHOUT going through a type error, so they were
  found by grep, not by the compiler** — check them if a title ever looks wrong.
  `sortAnimeRecords`' `case 'title'` (an alphabetical sort computed on English
  titles while the grid renders romaji reads as a broken sort, hence its
  `titleLang` is required, not defaulted); `animeGraph.ts`'s node and franchise
  labels, which used raw `catalog.title` and so showed romaji while the rest of
  the app showed English — the preference now rides ON the `GraphIndex` and is
  part of `getGraphIndex`'s WeakMap key, or a changed preference would serve
  stale labels for the life of the record array. The third is an exemption:
- ⚠️ **The Google/JustWatch links deliberately do NOT follow the preference.**
  `searchTitle` in `AnimeCardView` and on the detail page stays English-then-
  romaji, because building a *search query* is a different question from naming
  a show — both services index Latin-script titles. It looks like an
  un-threaded call site and is not one; both spots carry a comment saying so.
- **The detail page's title provenance chips derive their field from the string
  shown**, not from `en ? 'alternativeTitles' : 'title'` as before. That test
  assumed English-first and mislabels every romaji/native reader. Note `en` and
  `ja` are BOTH `alternativeTitles`, so only `catalog.title` distinguishes
  itself — and the standalone Japanese line is suppressed when `ja` is already
  the primary or secondary, or `native` renders it twice.
- **Search is deliberately preference-INDEPENDENT and matches every name a
  title carries.** `applyNarrowingFilters`, `globalSearch`'s `bestTitleRank` and
  `/catch-up`'s franchise filter all test romaji + `en` + `ja` (+ synonyms in the
  global one) whatever `titleLanguage` says: you must be able to find a show by a
  name it has, not only by the one currently rendered. `ja` was missing from all
  three before this shipped, which was invisible while everything displayed
  English and would have meant a `native` reader could not search for what was on
  their own screen.
- **Fallback is an ordered list, not a single field.** `titleCandidates` returns
  all three in the preference's order; the primary is the first non-empty one
  and the secondary is the next *distinct* one. Only `catalog.title` is
  guaranteed present (`alternativeTitles` is absent on AniList-only titles, and
  MAL stores `en: ''` far more often than a real English title), so a `native`
  reader on a title with no Japanese name gets romaji with English underneath
  rather than a blank. This also generalized `getSecondaryTitle`, whose old
  "the romaji title when it differs" rule was only correct while the primary was
  always English.

### Environment variables

| Variable | Purpose |
|---|---|
| `DATA_PATH` | Root for JSON data files (default: `/app/data`) |
| `LOGS_PATH` | Diagnostics directory. **No writer today** — the connection log moved into the store (`DATA_PATH/logs/`, see above); the setting stays valid and displayed. |
| `MAL_CLIENT_ID` | MyAnimeList OAuth app client ID |
| `MAL_REDIRECT_URI` | OAuth redirect URI |
| `CRON_SECRET` | Auth token for cron-sync endpoint. ⚠️ A `cronSecret` saved via `/settings` **overrides** this (`resolveSetting` reads stored before env) — see the cron-sync section |
| `SIMKL_CLIENT_ID` | SIMKL OAuth app client ID (required query param on every SIMKL request) |
| `SIMKL_CLIENT_SECRET` | SIMKL OAuth token exchange (confidential client) |
| `SIMKL_APP_NAME` | Sent as `app-name` query param + `User-Agent` on SIMKL requests |
| `SIMKL_REDIRECT_URI` | SIMKL OAuth redirect URI |
| `ANILIST_CLIENT_ID` | AniList OAuth app client ID (login tier only — the catalog/tags sync needs no key) |
| `ANILIST_CLIENT_SECRET` | AniList OAuth token exchange |
| `ANILIST_REDIRECT_URI` | AniList OAuth redirect URI |

### Pages importing from `@/lib/store`

Everything under [src/lib/store/](src/lib/store/) uses Node.js `fs`/`path` (via `jsonStore.ts`) and must never be bundled client-side. Only **pages** (`getServerSideProps`, API routes) import it, and always as values, since they run server-side. Client **components** never need it — they get their types (`AnimeRecord`, `UserAnimeStatus`, etc.) from [@/models/anime](src/models/anime/index.ts), which has no `fs` dependency and is safe to import as values from either side.

**This is enforced, not merely conventional** (docs/DECISIONS.md). A `files`-scoped block in [eslint.config.mjs](eslint.config.mjs) fails `npm run lint` — and `npm run build`, whose `prebuild` step runs the linter — when anything under `src/components/`, `src/hooks/` or `src/models/` imports a server-only path as a **value**: `@/lib/store/**`, `@/lib/config/{settings,connectionLog}`, `@/lib/providers/{registry,status,writers,cronSync}`, `@/lib/providers/{mal,simkl,anilist}/**`, `@/lib/reco/{anchored,boxes,data,feed,feedback,refresh,similar}` (each pattern doubled as `**/lib/…` so a relative path can't dodge the `@/` alias). It uses `@typescript-eslint/no-restricted-imports` **specifically for `allowTypeImports: true`** — the ~10 existing `import type` uses (e.g. `SimilarItem` from `reco/similar` in `MoreLikeThis`) are legitimate and erased at compile time; the base ESLint rule cannot tell the two apart. The client-safe set is the complement: `@/lib/domain/**`, `@/lib/url/**`, `@/lib/i18n`, `@/lib/reco/{weights,scoring,byCredits}`, `@/lib/providers/{capabilities,personalState,discrepancy}`, `@/lib/redirectUri`. `src/pages/**` is deliberately unguarded — it is the sanctioned seam. If you add a client-safe module to a guarded folder's reach, keep it out of the pattern list; if you make a listed module client-safe, remove it rather than adding an eslint-disable.

**Next 16 removed `next lint`, and `next build` no longer lints at all**, so the guard's enforcement is deliberately re-wired through `prebuild` (`css:types && lint && test`) — that script is the only reason a build still fails on a bad import, and now the only reason it fails on a broken invariant. Don't "simplify" `prebuild` back to `css:types` alone. **CI is `npm run build` and nothing else** ([.github/workflows/ci.yml](.github/workflows/ci.yml), push to main; no `pull_request` — this repo commits straight to main), so a check that belongs in CI belongs in `prebuild`, where local and CI cannot disagree. ⚠️ The sibling `copilot-setup-steps.yml` keeps its filename and job id because **both are reserved** — GitHub's Copilot coding agent runs that exact job to prepare its environment, so renaming it unhooks the agent silently. That is why the build moved into `ci.yml` instead of that file being renamed. The config is flat (`eslint.config.mjs`, ESLint 9); the parser/plugin come from the `typescript-eslint` meta package rather than the two `@typescript-eslint/*` packages, which is also what `eslint-config-next` itself depends on. Two rules from `eslint-plugin-react-hooks` v7 (the React Compiler set: `set-state-in-effect`, `refs`) are downgraded to **warnings** there — they flag ~26 long-standing fetch-in-effect patterns that are perf advisories, not bugs, and silencing them as errors is what keeps the real errors visible. There is a **second `files` block** in the same config, unrelated to client safety: it keeps `src/lib/mcp/**` and `api/anime/mcp.ts` from importing any write path, so the MCP surface stays read-only by build failure rather than by discipline.

**Two pinned holdbacks** (re-check when upstream moves): `eslint` stays on **9.x** because `eslint-config-next@16` bundles an `eslint-plugin-react` that crashes on ESLint 10 (`contextOrFilename.getFilename is not a function`), and `typescript` stays on **5.9.x** because `typescript-eslint@8` declares `typescript >=4.8.4 <6.1.0`, so TS 7 fails to install. Everything else is on latest.

### Import aliases

```typescript
import { ... } from '@/components/anime';
import { ... } from '@/models/anime';
import { ... } from '@/components/shared';
import { ... } from '@/lib/url/animeParams';
```

### Docker deployment

Multi-stage build, `next build --output standalone`, port `12344:3000`. Volume mounts for `/app/data` and `/app/logs`. See [Dockerfile](Dockerfile) and [docker-compose.yml](docker-compose.yml).

### Browser API constraints (production)
The NAS serves the app over HTTP (not HTTPS). Secure-context-only APIs (`navigator.clipboard`, etc.) are unavailable in production but work on localhost. Always provide a `document.execCommand` fallback for clipboard operations.
