# Phase 2 — The write registry (generic personal-state fan-out)

**Goal:** replace the hardcoded MAL+SIMKL fan-out in `rating.ts` (and the MAL-only write in
`mal-status.ts`) with a **per-provider writer registry**, so a rating/status/progress edit fans
out to every enabled writable provider — including the new **local** writer — and returns a
per-provider outcome map. This is the abstraction that makes Betaseries and a future AniList
writer plug in without touching endpoints.

Mirror the read side: reads already went generic via per-provider **extractors**
(`personalFromMal`, `personalFromSimkl`, …). This does the same for **writers**.

---

## 2a. The writer capability

A provider is writable iff it registers a writer. Read-only providers (AniList today) register
none. This keys off **capability, not identity** — the day AniList OAuth ships, it registers a
writer and automatically joins the fan-out with no endpoint change.

```ts
// src/lib/personalWriters.ts (new, server-only)
export type PersonalPatch = {
  status?: UserAnimeStatus;
  score?: number;           // 0 clears
  progress?: number;
};

export interface WriteOutcome {
  ok: boolean;
  matched?: boolean;        // provider matched the title (SIMKL's not_found case)
  error?: string;
}

export interface PersonalWriter {
  id: ProvenanceSource;                    // 'mal' | 'simkl' | 'local' | ...
  /** True when this writer is currently usable (token present / local enabled). */
  isEnabled(): boolean | Promise<boolean>;
  /** Apply the patch. LOCAL writer is the local-slice write; remote writers hit the API. */
  write(record: AnimeRecord, patch: PersonalPatch): Promise<WriteOutcome>;
}
```

## 2b. The three writers

- **`localWriter`** — always the write of last resort. `isEnabled()` = resolved
  `localProviderEnabled` (phase 1). `write()` upserts into `animes_local_personal.json`
  (`upsertLocalEntries`) with a fresh `updated_at`. Cannot fail on network; the one writer
  that always succeeds.
- **`malWriter`** — wraps existing [malWrite.ts](../../src/lib/malWrite.ts) `updateMalListStatus`.
  `isEnabled()` = MAL token present. Needs the real MAL id: `record.crosswalk.mal` /
  `record.sources.mal?.id`.
- **`simklWriter`** — wraps [simklWrite.ts](../../src/lib/simklWrite.ts) `pushSimklRating`.
  `isEnabled()` = SIMKL token present. **Score-only today** — SIMKL writes are the one narrow
  carve-out (see CLAUDE.md); a status/progress patch is a no-op for SIMKL (return
  `{ ok: true }` and skip, or `matched: false` — decide and document). Needs `crosswalk.mal` +
  `simkl_id`.

Registry = `[localWriter, malWriter, simklWriter]` (extended later with betaseries/anilist).

## 2c. The orchestrator

```ts
// Local-cache-authority order preserved: write the LOCAL RECORD first (so getEffective*
// reflects the edit immediately), THEN fan out to enabled remote writers.
export async function writePersonal(
  canonicalId: string,
  patch: PersonalPatch,
): Promise<Record<ProvenanceSource, WriteOutcome>>
```

1. **Local-record authority write first.** This is the subtle part — with local disabled (the
   MAL user), the value that `getEffectiveScore` reads still comes from the **local MAL slice**
   and **local SIMKL slice** (today's behavior). So the orchestrator must keep updating those
   local caches, exactly as `rating.ts` does now, *regardless of the local provider*. Concretely:
   - If `simklWriter.isEnabled()`: bump the **local** SIMKL entry (SIMKL-first effective read
     needs it — unchanged from today).
   - If `malWriter.isEnabled()`: bump the **local** MAL slice `my_list_status` (unchanged).
   - If `localWriter.isEnabled()`: write `animes_local_personal.json`.
   > i.e. "authority write" = whichever local slices feed the effective read under the current
   > precedence. Don't regress the MAL user by routing their edit only to the local provider.
2. **Remote fan-out** — `await` each enabled remote writer's `write()` (keep the tier board's
   **serial** discipline for SIMKL's per-user write-lock / 1 req/s cap). Collect outcomes.
3. Return the outcome map. Callers surface a red badge per failed provider (generalizes the
   tier board's existing `{ mal, simkl }` badge to `Record<providerId, outcome>`).

## 2d. Rewire the endpoints onto it

- **[rating.ts](../../src/pages/api/anime/animes/[id]/rating.ts)** → thin wrapper:
  validate score, `const outcomes = await writePersonal(id, { score })`, return
  `{ ok, score, outcomes }`. Its 44-line hand-rolled local-MAL + local-SIMKL + remote-MAL +
  remote-SIMKL body collapses into the orchestrator. **Behavior for the MAL user is
  identical** — verify byte-for-byte.
- **[mal-status.ts](../../src/pages/api/anime/animes/[id]/mal-status.ts)** → same, with a
  `{ status?, progress? }` patch. Note today it's MAL-only; after this it also lands in local
  when local is enabled, and is a no-op for the score-only SIMKL writer.
- **Client** — the tier board and any status control read `outcomes` instead of `{ mal, simkl }`.
  Iterate the map for per-provider failure badges.

## 2e. Response-shape change (breaking for clients)

`{ mal, simkl }` → `{ outcomes: Record<providerId, WriteOutcome> }`. Update:

- Tier board client ([tier.tsx](../../src/pages/tier.tsx)) — the red-badge logic.
- Any other caller of `POST …/rating` or `PUT …/mal-status`.

## Touch list (Phase 2)

- **New** `src/lib/personalWriters.ts` — types, three writers, `writePersonal` orchestrator.
- [src/pages/api/anime/animes/[id]/rating.ts](../../src/pages/api/anime/animes/[id]/rating.ts)
  — collapse onto `writePersonal`.
- [src/pages/api/anime/animes/[id]/mal-status.ts](../../src/pages/api/anime/animes/[id]/mal-status.ts)
  — collapse onto `writePersonal`.
- [src/lib/store.ts](../../src/lib/store.ts) — `upsertLocalEntries` (from phase 1) used by
  `localWriter`.
- Clients consuming the old `{ mal, simkl }` outcome shape.

## Verification

- **MAL user, drag a tier:** outcomes `{ mal: ok, simkl: ok }`, both remotes hit, local slice
  files unchanged in structure (MAL score in `animes_mal.json`, SIMKL in `animes_simkl.json`)
  — **identical to pre-phase behavior**.
- **Local-only user, rate on detail page:** outcomes `{ local: ok }`, value lands in
  `animes_local_personal.json`, effective score reflects it, no network calls.
- **Forced SIMKL failure:** outcome `{ simkl: { ok:false } }` surfaces the red badge; local
  values still updated.
