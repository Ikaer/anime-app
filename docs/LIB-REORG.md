# `src/lib` — inventory and reorganization guide

**Status:** proposal. Nothing here has been applied.
**Measured:** 2026-07-21, at `326d74d` (36 modules, 10,132 lines).

`src/lib` is the only directory under `src/` with no internal structure —
`components/` splits into `anime/`, `calculator/`, `shared/`; `models/` into
`anime/`; `lib/` is 36 files in one flat list. This document is the inventory
plus a phased plan to fix it.

Two constraints shape every recommendation below:

- **There are no tests.** Every step must be verifiable by the compiler
  (`npm run build`) rather than by a suite. That rules out rewrites and favours
  pure moves plus mechanical extractions. Where a step *does* change behaviour,
  it is flagged as such and kept small.
- **CLAUDE.md names ~40 of these paths.** A move is not done until CLAUDE.md's
  links are updated in the same commit, or the architecture doc silently rots
  into a map of a codebase that no longer exists. Budget for it.

---

## 1. Inventory

Columns: **L** = lines, **X** = exported symbols, **In** = modules importing it,
**Safety** = `S` server-only (transitively touches `fs`), `C` client-safe.

### The store / identity spine

| Module | L | X | In | Safety |
|---|---:|---:|---:|:--:|
| `store.ts` | 906 | **39** | **27** | S |
| `jsonStore.ts` | 152 | 5 | 11 | S |
| `bootstrap.ts` | 98 | 7 | 3 | S |

### Provider infrastructure (the well-factored cluster)

| Module | L | X | In | Safety |
|---|---:|---:|---:|:--:|
| `providerCapabilities.ts` | 265 | 16 | 7 | C |
| `providers.ts` | 119 | 6 | 6 | S |
| `providerStatus.ts` | 162 | 3 | 4 | S |
| `personalWriters.ts` | 310 | 4 | 2 | S |
| `personalState.ts` | 220 | 7 | 2 | C |
| `discrepancy.ts` | 107 | 2 | 3 | C |

### Per-provider pipes

| Module | L | X | In | Safety |
|---|---:|---:|---:|:--:|
| `mal.ts` | 221 | 13 | 13 | S |
| `malSync.ts` | 376 | 7 | 5 | S |
| `malWrite.ts` | 51 | 2 | 1 | S |
| `simkl.ts` | 134 | 13 | 5 | S |
| `simklSync.ts` | 164 | 2 | 3 | S |
| `simklWrite.ts` | 103 | 2 | 1 | S |
| `anilistSync.ts` | **1026** | 13 | 6 | S |
| `anilistCast.ts` | 408 | 5 | 3 | S |
| `anilistAuth.ts` | 153 | 15 | 7 | S |
| `anilistPush.ts` | 322 | 4 | 3 | S |
| `anilistPersonalSync.ts` | 270 | 7 | 5 | S |
| `anilistWrite.ts` | 148 | 3 | 2 | S |

### Recommendations

| Module | L | X | In | Safety |
|---|---:|---:|---:|:--:|
| `recommendations.ts` | **1255** | 20 | 6 | S |
| `recoWeights.ts` | 165 | 10 | 7 | C |
| `similarByCredits.ts` | 180 | 3 | 1 | C |

### Domain / pure

| Module | L | X | In | Safety |
|---|---:|---:|---:|:--:|
| `animeUtils.ts` | 440 | **18** | **22** | C |
| `animeUrlParams.ts` | 644 | 12 | 2 | C |
| `ratingGrids.ts` | 621 | 11 | 2 | C |
| `stats.ts` | 243 | 8 | 3 | C |
| `franchise.ts` | 143 | 3 | 1 | C |
| `globalSearch.ts` | 144 | 5 | 2 | C |
| `creditsCatalog.ts` | 73 | 4 | 1 | C |
| `searchLinks.ts` | 30 | 2 | 3 | C |

### Cross-cutting

| Module | L | X | In | Safety |
|---|---:|---:|---:|:--:|
| `i18n.tsx` | 119 | 11 | **43** | C |
| `settings.ts` | 196 | 24 | 8 | S |
| `connectionLog.ts` | 118 | 5 | 15 | S |
| `redirectUri.ts` | 46 | 4 | 4 | C |

**Totals:** 21 server-only, 15 client-safe.

---

## 2. Findings

### F1 — The client/server boundary is real, load-bearing, and invisible

21 of 36 modules transitively reach `fs`; 15 are safe to bundle. CLAUDE.md
devotes a whole section to this rule ("Pages importing from `@/lib/store`") and
`providerCapabilities.ts` / `providers.ts` were *deliberately split in two* to
honour it (PROVIDER-PARITY.md D2) — but a flat directory renders that split as
two adjacent filenames, so the reasoning survives only in prose.

Today the invariant holds by luck and discipline. Every client→server import in
the tree is `import type` (erased at compile time):

```
PersonalRoleActions.tsx  →  type AniListPushStats        from anilistPush   (S)
useConnections.ts        →  type HistoricalCrawlStats    from malSync       (S)
MoreLikeThis.tsx         →  type SimilarItem             from recommendations (S)
ProviderCard.tsx         →  type ProviderStatus          from providerStatus (S)
```

Any one of those becoming a value import drags `fs` into a client bundle. The
compiler will not stop it. A `server/` vs shared folder split, or an ESLint
`no-restricted-imports` zone, converts a naming convention into an enforced one.

### F2 — `store.ts` is three modules wearing one name

906 lines, 39 exports, 27 importers — the most-depended-on module in the app,
and it holds three separable concerns:

1. **Slice CRUD** (~24 exports): `getAll*` / `upsert*` / `remove*` repeated
   near-identically for seven slices — MAL catalog, MAL personal, SIMKL,
   AniList meta, AniList cast, AniList personal, local. This is the bulk of the
   file and the least interesting part of it.
2. **The identity spine** (lines ~404–576): `resolveCanonicalId(s)`,
   `getRegistry`, `resolveByMalId`, `getMalIdForCanonical`, `isCanonicalId`,
   `toNum`, the three crosswalk indexes. This is the architecturally load-bearing
   half — every write path goes through it — and it is buried in the middle of a
   CRUD file.
3. **The row join** (lines ~577–740): `getAnimeForDisplay`, its seven-slice
   identity cache, `getAnimeByCanonicalId`, `getAnimeByIdForDisplay`.

The seven CRUD blocks are so parallel that they should arguably be generated
from one `defineSlice<T>(file, key)` helper — but note that would be a
*behavioural* change (the shared-reference / cache-eviction contract in
`jsonStore.ts` is subtle), so it is filed as optional below, not as the main move.

### F3 — `recommendations.ts` is the worst offender: 1255 lines, six concerns

| Region | Lines | What it is |
|---|---:|---|
| Scoring kernel | 26–158 | `computeIdf`, `buildFieldProfile`, `fieldMatch`, `buildRejectionProfiles` — **pure**, no `fs`, no MAL |
| Persistence | 163–262 | `RecommendationsData` types + read/write of `cache/recommendations.json` |
| Feedback store | 264–312 | `user/reco_feedback.json` CRUD — an unrelated durable store |
| Seeds + heuristics | 314–457 | `getSeeds`, `isPrematureSequel`, `mmrRerank`, `jaccard` |
| `computeFeed` | 459–729 | **one 270-line function** |
| MAL HTTP client | 736–804 | `malFetch`, `fetchRecoEdges`, `fetchSuggestions`, `fetchAnimeDetail` |
| `performRecommendationsRefresh` | 806–1010 | **one 200-line function** |
| `computeSimilarTo` | 1010–1255 | the detail-page drill-down |

Two things stand out beyond the size. First, **the scoring kernel is pure and
client-safe** but is quarantined server-side by the `fs` imports at the top of
the file — the same mistake `recoWeights.ts` already exists to avoid (CLAUDE.md:
"never import them from `recommendations.ts` — it's `fs`-bound server-only").
The kernel belongs next to `recoWeights.ts`.

Second, **`malFetch` is a second MAL HTTP client**, living 500 lines away from
`mal.ts`, which is the designated one. `fetchAnimeDetail` here even re-imports
`MAL_ANIME_FIELDS` from `mal.ts` to rebuild a request `mal.ts` already knows how
to make.

### F4 — The AniList GraphQL transport is implemented four times

`anilistSync.ts` (1026 lines) is itself three sweeps stacked in one file — meta
sync, crowd recs, catalog crawl + bulk crawl — each carrying its own copy of the
endpoint constant, the ~2.1s throttle, and the 429/`Retry-After` retry. The same
transport is re-implemented in `anilistCast.ts`, `anilistPersonalSync.ts`, and
touched again in `anilistPush.ts`: **22 + 5 + 5 + 1 = 33 rate-limit/retry sites
across four files** for one API with one global rate limit.

That is not merely duplication, it is a correctness issue: four independent
throttles cannot cooperate, so two concurrent sweeps can exceed AniList's
degraded 30 req/min ceiling that each one is individually respecting. One
`anilistClient.ts` owning `{ endpoint, throttle, retry, auth-optional }` fixes
both problems at once.

Note the *queries* must stay separate — CLAUDE.md documents hard-won constraints
(`Page.media` vs aliased `Media`, one id filter per query, complexity ceilings).
Extract the transport, not the queries.

### F5 — `animeUtils.ts` is a grab bag holding something central

18 exports, 22 importers, and at least five unrelated concerns: title accessors,
`applyNarrowingFilters`, season formatting/`getSeasonInfos`, the three
`getEffective*` seams, precedence constants + `resolveLocalPrecedence`, and
**`toAnimeRecord` — the hydration engine**, which is one of the most important
functions in the app. A `-Utils` suffix is how a module stops being findable;
the hydration engine in particular deserves its own name.

### F6 — Smaller items

- **`ratingGrids.ts` (621 lines) and `animeUrlParams.ts` (644) are fine.** Both
  are large because they are *data tables* (the rubric; the preset/encoding
  tables), not because they do many things. Leave them alone. Size alone is not
  the smell — export count and concern count are.
- **Three OAuth token stores** (`mal.ts`, `simkl.ts`, `anilistAuth.ts`) share a
  read/write/validity shape but differ genuinely (MAL refreshes, SIMKL doesn't
  expire, AniList is a 1-year clock check). Per PROVIDER-ABSTRACTION.md's
  standing rule, **do not unify these.** Listed only so the next reader does not
  rediscover it as an opportunity.
- **`connectionLog.ts` has 15 importers** and is correctly small — no action.

---

## 3. Target layout

```
src/lib/
  i18n.tsx                    ← 43 importers; stays at root
  redirectUri.ts

  store/
    jsonStore.ts              (unchanged)
    registry.ts               ← identity spine out of store.ts (F2.2)
    slices.ts                 ← the 7 CRUD blocks   (F2.1)
    record.ts                 ← getAnimeForDisplay + row cache (F2.3)
    bootstrap.ts
    index.ts                  ← re-exports; keeps `@/lib/store` working

  providers/
    capabilities.ts           (was providerCapabilities.ts)   C
    registry.ts               (was providers.ts)              S
    status.ts                 (was providerStatus.ts)         S
    writers.ts                (was personalWriters.ts)        S
    personalState.ts                                          C
    discrepancy.ts                                            C
    mal/       client.ts  sync.ts  write.ts
    simkl/     client.ts  sync.ts  write.ts
    anilist/   client.ts  ← NEW: one transport/throttle (F4)
               auth.ts  meta.ts  catalogCrawl.ts  cast.ts
               personalSync.ts  push.ts  write.ts

  reco/
    weights.ts                (was recoWeights.ts)            C
    scoring.ts                ← pure kernel out of recommendations.ts  C
    feed.ts                   ← computeFeed
    similar.ts                ← computeSimilarTo
    refresh.ts                ← performRecommendationsRefresh
    feedback.ts               ← reco_feedback.json store
    data.ts                   ← RecommendationsData persistence
    byCredits.ts              (was similarByCredits.ts)

  domain/                     ← all client-safe, all pure
    hydrate.ts                ← toAnimeRecord + precedence  (F5)
    effective.ts              ← getEffective* seams
    filters.ts                ← applyNarrowingFilters
    titles.ts   season.ts
    franchise.ts  stats.ts  globalSearch.ts  creditsCatalog.ts
    ratingGrids.ts  searchLinks.ts

  url/
    animeParams.ts            (was animeUrlParams.ts)

  config/
    settings.ts
    connectionLog.ts
```

The layout encodes two axes the flat list cannot: **who owns it** (provider vs
store vs reco vs domain) and **where it may run** (`domain/`, `url/`,
`reco/weights|scoring`, `providers/capabilities` are the client-safe set).

---

## 4. Phased plan

Ordered by *value ÷ risk*. Each phase compiles independently; stop after any of
them and the tree is in a better state than before.

### Phase 1 — Pure moves, no code changes *(low risk, high clarity)*

Move files into the folders above, updating only import paths. Add
`store/index.ts` re-exporting the three store modules so `@/lib/store` keeps
resolving for its 27 importers.

Verify with `npm run build`. Nothing but paths changes, so a clean build *is*
the proof.

Do this as **one commit per folder** (`store/`, `providers/`, `reco/`,
`domain/`), each with its CLAUDE.md path updates included. A single 36-file move
commit is unreviewable and unrevertable.

### Phase 2 — Split `recommendations.ts` (F3) *(low risk, highest payoff)*

Mechanical extraction along the region table above; the seams are already marked
by the file's own `// ===` banners. Order:

1. `reco/scoring.ts` — the pure kernel. **Do this one first**: it is the only
   part with no `fs` coupling, so it is a straight cut, and it is what unblocks
   ever reusing the scoring math client-side.
2. `reco/feedback.ts`, `reco/data.ts` — two independent JSON stores.
3. `reco/similar.ts` — already self-contained (lines 1010–1255).
4. `reco/refresh.ts` — the orchestrator.
5. `reco/feed.ts` — what remains.

Then **delete `malFetch` and friends**, routing `fetchRecoEdges` /
`fetchSuggestions` / `fetchAnimeDetail` through `providers/mal/client.ts`. This
is the one behavioural step in the phase — MAL's client has its own error
handling — so keep it as its own commit, and check the reco refresh against a
real store afterwards (`npm run data:copy*` first).

Leave `computeFeed` and `performRecommendationsRefresh` long for now. They are
long because they are genuinely sequential pipelines, and splitting a 270-line
function without tests buys less than it risks. Revisit only if a change
actually needs it.

### Phase 3 — `providers/anilist/client.ts` (F4) *(medium risk, fixes a real bug)*

Extract one transport: endpoint, a **single module-level throttle**, the
429/`Retry-After` retry, optional auth header. Migrate the four callers to it.
Keep every query string exactly where it is.

This is the only phase that changes runtime behaviour meaningfully — and
deliberately, since a shared throttle is the point (F4). Verify by running a
meta-sync and a cast sweep concurrently against real data and watching for 429s
in the connection log.

### Phase 4 — Split `store.ts` (F2) *(medium risk, most invasive)*

Cut into `registry.ts` / `slices.ts` / `record.ts` behind the `index.ts` barrel
from Phase 1. Left until last on purpose: 27 importers and the app's central
invariant (resolve-before-mint) live here, and the earlier phases will have
already reduced how much *else* is in flight.

Optional follow-up, only if the CRUD repetition actually starts costing:
collapse the seven slice blocks into a `defineSlice<T>()` factory. Weigh it
carefully — the cache-eviction and shared-reference contracts documented in
`jsonStore.ts` are exactly the kind of subtlety a generic factory blurs.

### Phase 5 — Enforce the boundary (F1)

Add an ESLint `no-restricted-imports` zone forbidding `src/components/**` and
`src/hooks/**` from importing any server-only path (`@/lib/store/**`,
`@/lib/providers/{registry,status,writers,mal,simkl,anilist}/**`,
`@/lib/reco/{refresh,feed,data,feedback}`, `@/lib/config/settings`), with
`allowTypeImports: true` so the four legitimate `import type` uses in §F1 keep
working.

Cheap, and it is what makes the whole reorganization stick rather than decay.

---

## 5. Non-goals

Explicitly **not** proposed, so they are not rediscovered as ideas later:

- **Unifying the three OAuth token stores** — they differ genuinely; see F6 and
  PROVIDER-ABSTRACTION.md.
- **A generic provider sync interface.** MAL's seasonal crawl, SIMKL's two-phase
  delta and AniList's GraphQL batch are different operations. This document
  reorganizes where they live; it does not abstract what they do. The same rule
  that keeps `CatalogRoleActions` un-abstracted applies in `lib/`.
- **Splitting `ratingGrids.ts` / `animeUrlParams.ts`** — large data tables, one
  concern each.
- **Breaking up `computeFeed` / `performRecommendationsRefresh`** — see Phase 2.
- **A `lib/index.ts` barrel.** Would defeat the client/server split by making
  every module reachable through one specifier.
