# `src/lib` — inventory and reorganization guide

**Status:** Phases 1–3 applied (2026-07-21). Phases 4–5 still proposals.
**Measured:** 2026-07-21, at `326d74d` (36 modules, 10,132 lines).

The inventory below still uses the **pre-move** filenames, since that is what
the measurements and findings were taken against. §3 gives the target layout and
each phase records what it actually landed, including its deliberate deviations.

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

  reco/                     ← as built (Phase 2)
    weights.ts                (was recoWeights.ts)            C
    scoring.ts                pure kernel + TUNING            C
    feed.ts                   computeFeed + getSeeds
    similar.ts                computeSimilarTo
    refresh.ts                performRecommendationsRefresh
    feedback.ts               reco_feedback.json store
    data.ts                   RecommendationsData persistence
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

### Phase 1 — Pure moves, no code changes *(low risk, high clarity)* ✅ DONE

Move files into the folders above, updating only import paths. Add
`store/index.ts` re-exporting the three store modules so `@/lib/store` keeps
resolving for its 27 importers.

Verify with `npm run build`. Nothing but paths changes, so a clean build *is*
the proof.

Do this as **one commit per folder** (`store/`, `providers/`, `reco/`,
`domain/`), each with its CLAUDE.md path updates included. A single 36-file move
commit is unreviewable and unrevertable.

**Applied 2026-07-21** in five commits (`store/`, `providers/`, `reco/`,
`domain/`, then `url/` + `config/` together — the last two are two files each and
did not warrant separate commits). `npx tsc --noEmit` clean after each. Notes for
whoever picks up Phase 2:

- **`store.ts` became `store/index.ts` rather than a new barrel over three
  files.** Splitting it is Phase 4; making the barrel now would have meant either
  an index that re-exports one file (noise) or doing Phase 4 early. The 27
  `@/lib/store` importers were left untouched either way, which was the point.
- **`anilistSync.ts` landed as `providers/anilist/sync.ts`, not as
  `meta.ts` + `catalogCrawl.ts`.** That split is a Phase 3 concern; Phase 1 moved
  no code.
- **`recommendations.ts` landed as `reco/engine.ts`** — a holding name for a file
  Phase 2 empties into `scoring/feed/similar/refresh/feedback/data`. The region
  table in F3 still describes it accurately, just under the new path.
- Module *names* inside `domain/` were kept as-is (`animeUtils.ts` is still
  `animeUtils.ts`); the F5 split into `hydrate/effective/filters/titles/season`
  has no phase of its own yet.
- `animeUrlParams.ts`'s lone relative import (`'./animeUtils'`, the only one in
  `src/lib`) became an alias import, so no cross-folder relative paths remain.
- CLAUDE.md and `.github/copilot-instructions.md` were updated in the same
  commits; every `src/lib/…` link in CLAUDE.md was verified to resolve to a real
  file afterwards.

### Phase 2 — Split `recommendations.ts` (F3) *(low risk, highest payoff)* ✅ DONE

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

**Applied 2026-07-21** in three commits — the extraction (in the order above,
landed as two commits), then the MAL routing on its own as required. `engine.ts`
is gone; `reco/` is now `scoring` `data` `feedback` `feed` `similar` `refresh`
plus the pre-existing `weights` / `byCredits`. Notes:

- **The extraction was verified as behaviour-preserving, not merely compiling.**
  `computeFeed` and `computeSimilarTo` were run against the salon store on
  `1da0f17` and on the result, and their output diffed: 1122 feed items with
  identical ids, affinity scores to 6 decimals and breakdown lengths, plus an
  identical drill-down. Worth redoing the same way for Phase 4 — a probe that
  compiles `src/lib` to CommonJS in a scratch dir with a `@/`→`src/` require
  hook takes minutes and is far stronger evidence than a clean build.
- **`getSeeds` is exported from `feed.ts`**, not duplicated into `refresh.ts`.
  Both halves need the seed set and it must stay one definition; that makes
  `refresh` → `feed` the one intra-folder dependency (`FeedOptions` rides along).
- **`TUNING` moved wholesale into `scoring.ts`** rather than being split by
  consumer. "All knobs in one place" was worth more than a purist boundary,
  even though `FETCH_DELAY_MS` is a fetch concern. `MAX_429_RETRIES` did leave —
  it belongs to the transport, and the transport is now MAL's.
- **`computeIdfSet` / `buildFieldProfileSet`** collapse the two identical
  six-line idf/profile blocks `computeFeed` and `computeSimilarTo` each carried.
- **The MAL step fixed a real gap.** The 429 retry existed *only* in the reco
  copy, so `malGet` — and with it the seasonal crawl and the personal-list read,
  the two calls that paginate hardest — had none. It now lives in `malGet`.
  `fetchAnimeRecommendations` / `fetchUserSuggestions` are new there;
  `fetchRecoEdges` survives in `refresh.ts` as a three-line wrapper holding only
  the reco-side concerns (MAL's 10-per-anime cap, the `hop` tag). All three were
  live-verified against a real token.
- CLAUDE.md's "Pour toi" section was rewritten to name the six modules, and
  every `src/lib/reco/…` link re-verified to resolve.
- Not done, and still worth doing: `scoring.ts` is client-safe but nothing
  imports it client-side yet. Phase 5's ESLint zone is what would keep it that
  way.

### Phase 3 — `providers/anilist/client.ts` (F4) *(medium risk, fixes a real bug)* ✅ DONE

Extract one transport: endpoint, a **single module-level throttle**, the
429/`Retry-After` retry, optional auth header. Migrate the four callers to it.
Keep every query string exactly where it is.

This is the only phase that changes runtime behaviour meaningfully — and
deliberately, since a shared throttle is the point (F4). Verify by running a
meta-sync and a cast sweep concurrently against real data and watching for 429s
in the connection log.

**Applied 2026-07-21** as one commit: `client.ts` (185 lines) added, 252 lines
deleted across the six callers for 82 added. Notes:

- **The throttle is a slot allocator, not a sleep.** Each caller claims the next
  free 2.1s slot *before* its fetch (`nextSlotAt = max(now, nextSlotAt) + delay`)
  rather than sleeping after it, which is what lets concurrent sweeps interleave
  on one cadence instead of each pacing itself. Consequence: **every
  `setTimeout` in the sweep loops is gone** — `sync.ts` lost five (between meta
  batches, rec batches, hydration batches, catalog pages and bulk-crawl seasons),
  `cast.ts` and `push.ts` one each. A loop that still slept would be
  double-pacing, not belt-and-braces. A 429 additionally calls `backOff`, which
  pushes *every* waiting caller out, not just the one that hit it.
- **Verified live, on the exact F4 scenario.** `client.ts` has no `@/` imports,
  so it transpiles standalone: two sweeps (3 batched `Page.media` enrichment
  queries + 3 single-title cast queries) were run concurrently against the real
  API through one compiled copy. Requests came out strictly alternating at
  +206/2267/4358/6439/8555/10653 ms — min gap 2061 ms, six requests in 10.7 s
  (~34 req/min → the old behaviour would have been ~57), no 429, every response
  valid. Before this, the same pair each ran its own 2.1s loop.
- **Three entry points, because the callers disagree about what an error is.**
  `anilistQuery` (strict: throws on non-2xx or any `errors` entry, returns
  `data`) covers the sweeps. `cast.ts` needs `anilistFetch` — the raw
  `{status, ok, body}` — because a **404 is a legitimate answer** there, and
  collapsing it into the strict variant would have re-broken the empty-cast bug
  CLAUDE.md documents. `personalSync.ts` also takes the raw form: it must
  classify failures into `AniListPersonalErrorKind`, and AniList reports
  "User not found" as a GraphQL error under a 404. `anilistGraphQL` (envelope
  passthrough) moved out of `auth.ts` unchanged in contract, so `write.ts` still
  maps `errors` onto its own `WriteOutcome`.
- **`auth.ts` is now purely the token store** (153 → 114 lines): file I/O, CSRF
  state, validity clock, viewer lookup. It imports the transport like everyone
  else. `ANILIST_ENDPOINT` no longer belongs to it.
- **`sync.ts` was NOT split into `meta.ts` + `catalogCrawl.ts`.** §3's layout
  still shows that split; it is a separate concern from F4 (which is about the
  transport, not the sweeps), and this phase's own brief says to keep every query
  where it is. 1026 → 936 lines, all of the loss being deleted transport.
- Interactive writes (a tier-board drag) now share the throttle too, so one can
  wait up to ~2.1s while a sweep runs. That is the intended trade: a queued write
  beats a 429'd one, and the sweeps are the rare case.
- CLAUDE.md's AniList section gained a `client.ts` bullet; the per-sweep
  "throttled to ~28 req/min" sentence moved there rather than being repeated.

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
