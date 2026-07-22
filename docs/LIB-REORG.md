# `src/lib` — layout and the rules behind it

> Closed. The reorganization (5 phases) is applied; this keeps the **target
> layout** and the reasoning that has to survive, because CLAUDE.md and code
> comments cite it.

## Layout

```
src/lib/
  i18n.tsx                    ← 43 importers; stays at root
  redirectUri.ts

  store/
    jsonStore.ts              raw file I/O primitives
    registry.ts               identity spine — mint-or-resolve canonical ids
    slices.ts                 one read/write block per JSON file
    record.ts                 the join: 7 slices → AnimeRecord[]
    recordCache.ts            the row cache, extracted to keep the two acyclic
    bootstrap.ts
    index.ts                  barrel; keeps `@/lib/store` working for ~25 importers

  providers/
    capabilities.ts     C     declarative: what a provider is and can do
    registry.ts         S     runtime: is it connected right now
    status.ts           S     one status row per provider
    writers.ts          S     the PersonalWriter registry
    personalState.ts    C     the per-provider extractor table
    discrepancy.ts      C     pure N-provider comparison
    mal/       client.ts  sync.ts  write.ts
    simkl/     client.ts  sync.ts  write.ts
    anilist/   client.ts  ← the ONE transport/throttle
               auth.ts  sync.ts  cast.ts  personalSync.ts  push.ts  write.ts

  reco/
    weights.ts          C     DEFAULT_WEIGHTS + URL (de)serialization + UI metadata
    scoring.ts          C     pure kernel + TUNING (every knob in one place)
    feed.ts                   computeFeed + getSeeds
    similar.ts                computeSimilarTo
    refresh.ts                performRecommendationsRefresh
    feedback.ts               reco_feedback.json store
    data.ts                   RecommendationsData persistence
    byCredits.ts        C

  domain/                     all client-safe, all pure
    animeUtils.ts   franchise.ts  stats.ts  globalSearch.ts
    creditsCatalog.ts  ratingGrids.ts  searchLinks.ts

  url/     animeParams.ts
  config/  settings.ts  connectionLog.ts
```

`S` = server-only (transitively touches `fs`), `C` = client-safe.

The layout encodes two axes a flat directory cannot: **who owns it** (provider /
store / reco / domain) and **where it may run**.

## The rules

### The client/server boundary is enforced, not conventional *(F1 / Phase 5)*

21 of 36 modules transitively reach `fs`. The invariant used to hold by luck: a
legitimate `import type` becoming a value import drags `fs` into a client bundle
and the compiler will not stop it.

An `overrides` block in [.eslintrc.json](../.eslintrc.json) fails `npm run lint`
(and `next build`, which lints) when `src/components/**`, `src/hooks/**` or
`src/models/**` imports a server-only path as a **value**. Details:

- It must be `@typescript-eslint/no-restricted-imports`, **specifically for
  `allowTypeImports: true`** — the base ESLint rule and
  `eslint-plugin-import`'s `no-restricted-paths` both report on every
  `ImportDeclaration` regardless of `importKind`, flagging the ~10 legitimate
  `import type` uses. The plugin is pinned to the parser version
  `eslint-config-next` ships.
- Each pattern is doubled as `**/lib/…` so a relative path cannot walk around the
  `@/` alias.
- **`src/pages/**` is deliberately unguarded** — it is the sanctioned seam.
- A restriction rule that never fires is indistinguishable from no rule, so
  **verify it actually triggers**, not merely that lint is green.

### One transport per external API, one throttle *(F4 / Phase 3)*

Four independent AniList throttles could not cooperate: two concurrent sweeps
each respected 28 req/min while together exceeding the ceiling.
`providers/anilist/client.ts` owns endpoint + throttle + 429 retry + optional
auth.

The throttle is a **slot allocator, not a sleep** — each caller claims the next
free slot *before* its fetch (`nextSlotAt = max(now, nextSlotAt) + delay`), which
is what lets concurrent sweeps interleave on one cadence. Consequence: a sweep
loop that still slept would be double-pacing, so **no `setTimeout` pacing remains
in the callers**. A 429 calls `backOff`, pushing *every* waiting caller out.

Three entry points, because the callers genuinely disagree about what an error
is: `anilistQuery` (strict, throws — the sweeps), `anilistFetch` (raw
`{status, ok, body}` — `cast.ts` reads a 404 as "no cast", `personalSync.ts`
classifies failures), `anilistGraphQL` (envelope passthrough for writes).

**The queries stay with their callers.** The `Page.media`-vs-aliased-`Media`,
one-id-filter and complexity-ceiling constraints are per query.

### Layering inside `store/` *(F2 / Phase 4)*

`registry` → `slices` → `record`, with `recordCache` off to the side. Two
deliberate exceptions, both documented in code:

- **The row cache needs its own module.** `record.ts` imports every slice reader,
  so a cache living there would force the slice *writers* to import back from it —
  mutually recursive.
- **`getMalIdForCanonical` sits in `slices.ts`, not `registry.ts`**, because its
  first step consults the MAL catalog slice, and the registry must stay *below*
  the slices so slice writes can resolve ids without a cycle.

### Size is not the smell

Export count and concern count are. `ratingGrids.ts` and `url/animeParams.ts` are
large because they are **data tables** (the rubric; the preset/encoding tables),
one concern each.

## Non-goals

Explicitly **not** proposed, so they are not rediscovered as ideas:

- **Unifying the three OAuth token stores.** They differ genuinely — MAL
  refreshes, SIMKL doesn't expire, AniList is a 1-year clock check.
- **A generic provider sync interface.** See [PROVIDER-ABSTRACTION.md](PROVIDER-ABSTRACTION.md).
- **Splitting `ratingGrids.ts` / `url/animeParams.ts`.**
- **Breaking up `computeFeed` / `performRecommendationsRefresh`.** They are long
  because they are genuinely sequential pipelines; splitting a 270-line function
  without tests buys less than it risks.
- **A `lib/index.ts` barrel.** Would defeat the client/server split by making
  every module reachable through one specifier.

## Verifying a refactor here, given there are no tests

A clean build proves paths, not behaviour. The stronger probe: compile `src/lib`
+ `src/models` to CommonJS in a scratch dir with a `@/`→`src/` require hook, run
the function against a real store before and after, and diff the dumps.

**Point `DATA_PATH` at a copy, or probe read paths only** — a probe that writes
can persist state the app treats as terminal (an empty `characters: []` cast
entry short-circuits forever).
