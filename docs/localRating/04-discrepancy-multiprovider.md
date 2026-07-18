# Phase 4 — Multi-provider discrepancy

**Goal:** the discrepancy detection + page currently assume exactly two personal providers
(MAL, SIMKL). Generalize to **N providers** (MAL, SIMKL, local, later Betaseries/AniList) so
disagreements between any providers surface, rendered in the grouped long format from the
screenshot (one sub-row per provider under each anime).

> The blast radius here is `computeDiscrepancy`'s **signature and return shape**, not just the
> page — it's called in the store assembly and consumed in four places. Enumerate them (below)
> rather than treating this as a rendering change.

---

## 4a. Model change — pairwise → per-provider map

Today ([models/anime/index.ts:133](../../src/models/anime/index.ts)):

```ts
export interface Discrepancy {
  status?: { mal: UserAnimeStatus | null; simkl: UserAnimeStatus };
  score?:  { mal: number | null; simkl: number | null };
  progress?: { mal: number | null; simkl: number | null };
  presence?: 'simkl_only';
}
```

Generalize to per-provider values keyed by `ProvenanceSource`:

```ts
/** One provider's personal state for the discrepancy comparison. */
export interface ProviderPersonalState {
  status?: UserAnimeStatus;
  score?: number | null;
  progress?: number | null;
  present: boolean;   // did this provider have any entry for the title?
}

/** Per-provider snapshot for a title where at least two providers disagree. */
export interface Discrepancy {
  /** Only providers that HAVE an entry (or are relevant to the disagreement). */
  providers: Partial<Record<ProvenanceSource, ProviderPersonalState>>;
  /** Which dimensions actually disagree — drives highlighting + "any disagreement?" */
  disagree: { status: boolean; score: boolean; progress: boolean };
  /** Generalized presence: providers that have the title vs those that don't. */
  presence?: { present: ProvenanceSource[]; absent: ProvenanceSource[] };
}
```

- `presence` generalizes from `'simkl_only'` to "present on some, absent on others".
- Preserve the **`bothFullyWatched` reconciliation** ([simklCompare.ts:64](../../src/lib/simklCompare.ts)):
  differing progress where every present provider has watched all of *its own* total is **not**
  a disagreement. Generalize the pairwise check to "all present providers fully watched".
- A title is a discrepancy iff `disagree.*` has any `true` **or** `presence` splits providers.

## 4b. Detection change

Rename/repurpose `computeDiscrepancy` to take the **raw slices**, not a MAL+SIMKL pair.
Currently `(anime: MALAnime, simkl?: SimklPersonalEntry)`; new shape:

```ts
export function computeDiscrepancy(
  states: Partial<Record<ProvenanceSource, ProviderPersonalState>>
): Discrepancy | null
```

Each provider's `ProviderPersonalState` is built from its **raw slice** (not the effective
merged value — the whole point is to detect mismatches *between* sources). Build them from:
`sources.mal?.my_list_status`, `sources.simkl`, `sources.local`, (later) betaseries/anilist.

- Keep it **pure / client-safe** (no `fs`) like today's `simklCompare.ts` — it's imported by
  React components (`SimklDiscrepancyBadge`).
- The status vocabulary maps (`mapSimklStatus`) stay; each provider normalizes to MAL vocab at
  slice-write time already, so the comparison is apples-to-apples.

## 4c. Every consumer of `computeDiscrepancy` / `Discrepancy` (the touch list)

1. **[store.ts `assembleDisplayRow`](../../src/lib/store.ts)** — builds the per-provider states
   from the raw slices and calls the new `computeDiscrepancy`. (Currently
   `computeDiscrepancy(mal, simkl)`.)
2. **`SimklDiscrepancyBadge`** (card badge) — rename to a provider-neutral
   `DiscrepancyBadge`; it now summarizes N providers ("MAL ≠ SIMKL ≠ local" or a count) rather
   than a fixed MAL-vs-SIMKL glyph. Find it under
   [src/components/anime/](../../src/components/anime/).
3. **`disc` / `discrepancies` filter** in
   [api/anime/animes/index.ts](../../src/pages/api/anime/animes/index.ts) — the
   `discrepanciesOnly` filter now means "any provider disagreement", reading the new
   `discrepancy != null`. The `AnimeListResponse.filters.discrepancies` echo stays.
4. **[discrepancies.tsx](../../src/pages/discrepancies.tsx)** — the dedicated page. Re-render as
   the **grouped long format**:

   | Anime | Provider | Note | Status | Épisodes |
   |---|---|---|---|---|
   | *Anime1* | Local | 8 | Completed | 12/12 |
   |  | MAL | 7 | Completed | 12/12 |
   |  | SIMKL | — | Watching | 8/12 |

   Anime spans its provider sub-rows; disagreeing cells highlighted. Scales vertically as
   providers are added (no column blow-out on the 4K table). Fetches the same
   `?discrepancies=true&limit=all`.

## 4d. Interaction with the write registry (phase 2)

Nice side effect: because phase 2 fans writes out to **all** enabled providers, a
rating/status edit keeps them in sync, so the discrepancy set **shrinks** to genuine
divergences — read-only providers and **failed** remote writes (which is exactly what you want
the page to surface). The per-provider outcome badges (phase 2) and the discrepancy page become
complementary views of "are my providers in sync".

## Touch list (Phase 4)

- [src/models/anime/index.ts](../../src/models/anime/index.ts) — `Discrepancy` reshape +
  `ProviderPersonalState`.
- [src/lib/simklCompare.ts](../../src/lib/simklCompare.ts) — rename to a provider-neutral module
  (e.g. `discrepancy.ts`); new `computeDiscrepancy` + generalized `bothFullyWatched` + presence.
- [src/lib/store.ts](../../src/lib/store.ts) — build per-provider states, call new signature.
- `SimklDiscrepancyBadge` → `DiscrepancyBadge` in [components/anime/](../../src/components/anime/).
- [src/pages/api/anime/animes/index.ts](../../src/pages/api/anime/animes/index.ts) — filter reads
  new shape.
- [src/pages/discrepancies.tsx](../../src/pages/discrepancies.tsx) — grouped long-format table.
- i18n keys for the new column headers / provider labels.

## Verification

- **Two-provider parity:** with only MAL+SIMKL, the new detection flags the *same* titles the
  old pairwise one did (regression check against current discrepancy list).
- **Three providers:** contrive MAL=7, SIMKL=8, local=8 on one title → row shows all three, only
  the MAL score cell highlighted.
- **Presence split:** title on local + SIMKL but not MAL → `presence` lists it; page shows the
  absent provider row as "—".
- **bothFullyWatched:** MAL 12/12, SIMKL 13/13 completed → **not** flagged.
