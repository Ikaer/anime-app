# SIMKL Integration — Design

**Date:** 2026-07-04
**Status:** Approved, ready for implementation plan
**Spike:** already working (`src/lib/simkl.ts`, `src/pages/api/anime/simkl/{auth,library}.ts`, `src/pages/simkl-test.tsx`, `docs/simkl/apirules.md`)

## Goal

Integrate SIMKL as a **read-only** second source of the user's personal anime data, alongside the existing MyAnimeList (MAL) integration. Pull the user's SIMKL library (status / score / progress), merge it into the app's existing anime records **at display time**, and surface **discrepancies** between MAL and SIMKL for the same title. No writes are ever made to SIMKL.

## Non-goals / explicitly deferred

Named here so they aren't silently dropped; each becomes its own spec later:

- **SIMKL "big-sync" for tags** — fetching every catalog anime's detail (regardless of the user's status) to harvest SIMKL's richer tag system. This is the *only* way to get tags for un-statused titles, and it feeds a future `simklTags` recommendation source in the existing weighted-scoring model.
- **MAL-internal discrepancy detection** (the other `docs/TODO.md` item: e.g. status "completed" but `num_episodes_watched` < total).
- **Flipping effective-status to SIMKL** (or MAL-then-SIMKL fallback) for the existing status filters / reco unseen-exclusion.
- **Wiring SIMKL delta-sync into `cron-sync`** for automatic freshness.

## Key decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Storage layout | Lean separate `animes_SIMKL.json`, MAL-id keyed, merged at display | Mirrors the existing `animes_hidden.json` side-file pattern; honors "systems kept separated, merged in the UI"; avoids duplicating MAL metadata; makes discrepancy diff trivial (two records under one key). |
| Orphans (SIMKL item with no MAL id, or MAL id not in catalog) | Skip + log, return count in sync stats | Simplest; keeps the whole app in one MAL-id identity space. Revisit only if it proves to hide meaningful titles. |
| Discrepancy UX | Per-card badge + a "discrepancies only" sidebar filter, on the **main page** | Discrepancy is an annotation + narrowing over the already-merged list — expressible as a filter, so no dedicated page (unlike "Pour toi", which is a computed ranking). Honors "no special page for SIMKL". |
| Authority | MAL stays authoritative | Existing status filters, sort, and "Pour toi" unseen-exclusion keep reading MAL. SIMKL is display + discrepancy only. Smallest blast radius; the user plans to flip to SIMKL later once the SIMKL catalog is fuller. |
| Status normalization | Normalize SIMKL status → MAL vocabulary at **write** time | Store canonical values so comparison and display are trivial downstream. |
| Presence mismatch | "Statused on only one side" is a **soft** discrepancy (`presence`), distinct from a value mismatch | Distinguishes "MAL says watching, SIMKL says completed" from "SIMKL has it, MAL doesn't". |
| Sync scope | Personal library only (statused anime), like MAL's light sync | SIMKL's `/sync/all-items/anime` returns the user's statused library. Catalog-wide fetch (for tags) is the deferred big-sync. |
| Rating scale | No rescaling | SIMKL user ratings are 1–10, identical to MAL's scale. |

## Architecture

### Data model

New side-file `animes_SIMKL.json` under `DATA_PATH`, keyed by MAL id (string), value:

```ts
// src/models/anime/index.ts
export interface SimklPersonalEntry {
  simkl_id: number;          // kept for deletion reconciliation (diff on ids.simkl)
  mal_id: number;
  status: UserAnimeStatus;   // normalized to MAL vocabulary at write time
  score: number | null;      // SIMKL user rating, 1–10; null if unrated
  num_episodes_watched: number | null;
  total_episodes: number | null;
  watched_at?: string;       // SIMKL last_watched
  updated_at?: string;       // SIMKL item timestamp
}
```

`AnimeForDisplay` gains an optional joined field and a computed discrepancy:

```ts
export interface AnimeForDisplay extends MALAnime {
  hidden?: boolean;
  simkl?: SimklPersonalEntry;      // joined at display time by MAL id
  discrepancy?: Discrepancy | null; // computed at display / filter time
}
```

New watermark file `simkl_sync_checkpoint.json` → `{ lastActivityAll: string }` (the `activities.anime.all` timestamp, stored **exactly as received**, ISO 8601 UTC).

### File I/O & cache — stays in `anime.ts`

Per the CLAUDE.md rule that `anime.ts` owns all file I/O plus the 10-min display cache, add there:

- `getAllSimklEntries(): Record<string, SimklPersonalEntry>`
- `upsertSimklEntries(entries: SimklPersonalEntry[]): void` — writes the file and sets `cachedAnime = null`
- `removeSimklEntries(malIds: number[]): void` — for deletion reconciliation; invalidates cache
- `getAnimeForDisplay()` — after building the MAL+hidden records, joins `simklByMalId[anime.id]` onto each and computes `discrepancy` via `computeDiscrepancy`.

`simklSync.ts` (below) performs the SIMKL **API** work and calls these persistence functions. This keeps API orchestration separate from file I/O while respecting the "cache invalidated inside every write" invariant.

### SIMKL client & sync — `src/lib/simklSync.ts`

Server-only (uses `fetch` + reads token from `simkl.ts`). Every request carries the required `client_id`, `app-name`, `app-version` query params + `Authorization: Bearer` and `User-Agent` headers (omitting `client_id` yields `412 client_id_failed`).

`performSimklSync()` implements the two-phase model from `apirules.md`:

1. **Phase 1 — initial (no watermark):**
   - `GET /sync/all-items/anime?extended=ids_only` — `ids_only` adds external IDs including `mal` (needed for keying) on top of the default per-item status / rating / progress.
   - Normalize each item → `SimklPersonalEntry` (status mapped to MAL vocab; orphans without a `mal` id skipped + counted).
   - `upsertSimklEntries(...)`.
   - `GET /sync/activities`, save `anime.all` to `simkl_sync_checkpoint.json`.
2. **Phase 2 — delta (watermark present):**
   - `GET /sync/activities`. If `anime.all` equals the saved value → stop (nothing changed).
   - Else `GET /sync/all-items/anime?date_from=<saved>&extended=ids_only`, normalize, `upsertSimklEntries(...)`, advance watermark.
3. **Deletion reconciliation:**
   - When `activities.anime.removed_from_list` differs from a stored value, `GET /sync/all-items/anime?extended=simkl_ids_only`, diff the returned `ids.simkl` against local entries, and `removeSimklEntries(...)` for any local MAL id whose SIMKL id is no longer present (also drops its stored rating, which SIMKL wipes on list removal).

**Verify during implementation:** confirm the user `rating` is present inline in `/sync/all-items/anime?extended=ids_only`. If it is not, add a second `GET /sync/ratings/anime` call and merge ratings by SIMKL id before persisting. The docs are ambiguous on this; the spike response should be inspected first.

Returns stats: `{ added, updated, removed, orphansSkipped, phase: 'initial' | 'delta' | 'noop' }`.

### Discrepancy detection — `src/lib/simklCompare.ts` (client-safe, pure)

No `fs`/Node imports, so it can be imported by both the API handler and React components.

- `mapSimklStatus(raw: string): UserAnimeStatus` — vocabulary bridge (`plantowatch`→`plan_to_watch`, `hold`→`on_hold`; `watching`/`completed`/`dropped` unchanged). Used at sync write time.
- `computeDiscrepancy(mal: MALAnime, simkl?: SimklPersonalEntry): Discrepancy | null`:

```ts
export interface Discrepancy {
  status?: { mal: UserAnimeStatus | null; simkl: UserAnimeStatus };
  score?: { mal: number | null; simkl: number | null };
  progress?: { mal: number | null; simkl: number | null };
  presence?: 'mal_only' | 'simkl_only'; // soft: statused on exactly one side
}
```

Returns `null` when there is nothing to compare or everything matches. Value mismatches (`status`/`score`/`progress`) populate their sub-objects with both sides. `presence` is set when exactly one side has a status; it is a *soft* signal distinct from a value mismatch. Score/progress equality treats `null`/absent leniently (a missing SIMKL score is not a mismatch against a MAL score — only two present-and-differing values count).

### Effective-status seam

New `getEffectiveStatus(anime: AnimeForDisplay): UserAnimeStatus | undefined` returning MAL's `my_list_status.status` today. The status filter in the animes API handler and the reco unseen-exclusion call **this helper** instead of reading `my_list_status` directly, so a future switch to SIMKL (or MAL-then-SIMKL fallback) is a one-line change. (This is a small refactor of existing reads; behavior is unchanged now.)

### Filtering

New narrowing filter `discrepanciesOnly: boolean`. Threads through the documented "~6 spots" for a new filter dimension:

1. `AnimeFiltersState` + `DEFAULT_FILTERS` in `animeUrlParams.ts`
2. `PARAM_KEYS` + encode/decode in `animeUrlParams.ts`
3. `filters` memo in `useAnimeUrlState.ts`
4. request-param building in `index.tsx`
5. handler in `api/anime/animes/index.ts` — after the merge, keep only records whose `discrepancy` is non-null
6. `AnimeListResponse.filters` echo type

Because the filter needs `discrepancy`, the animes API handler computes the merge+discrepancy (via `getAnimeForDisplay`) before applying it. No effect on other filters.

### UI

- **`SimklDiscrepancyBadge`** (new component, CSS Module) — rendered on `AnimeCardView` cards and `AnimeTable` rows when `anime.discrepancy` is non-null. Compact form, e.g. `MAL: watching · SIMKL: completed`, `★7 vs ★8`, `12/24 vs 24/24`. A `presence` discrepancy renders a subtler "SIMKL only" / "MAL only" tag.
- **SIMKL status chip** — when `anime.simkl` exists, show SIMKL's own status/score as a small chip even if there's no mismatch, so the merge is visible.
- **Account sidebar section** — extend the existing MAL account UI with SIMKL connect / disconnect (productionizing the spike `auth.ts`), last-sync timestamp, and a **"Sync SIMKL"** button.
- **"Discrepancies only" toggle** — in the sidebar filters area, wired to the `discrepanciesOnly` URL param.

Run `npm run css:types` after adding any `.module.css`.

### Endpoints

- `src/pages/api/anime/simkl/auth.ts` — productionize from the spike (OAuth start + callback, CSRF state, token exchange, disconnect).
- `POST /api/anime/simkl/sync` — runs `performSimklSync()`, returns the JSON stats object. Plain request/response (no SSE — the delta path is one or two light calls).
- `GET /api/anime/simkl/status` (optional) — returns `{ connected, lastSync, entryCount }` to drive the Account UI.
- Remove the spike `src/pages/api/anime/simkl/library.ts` and `src/pages/simkl-test.tsx` once the real sync path is in place.

### Config

Add to `.env.example`, the CLAUDE.md env-var table, and a new "SIMKL integration" section in CLAUDE.md architecture:

| Variable | Purpose |
|---|---|
| `SIMKL_CLIENT_ID` | SIMKL OAuth app client id (required query param on every request) |
| `SIMKL_CLIENT_SECRET` | OAuth token exchange (confidential client) |
| `SIMKL_APP_NAME` | Sent as `app-name` query param + `User-Agent` |
| `SIMKL_REDIRECT_URI` | OAuth redirect URI |

## Data flow (summary)

1. User clicks **Sync SIMKL** → `POST /api/anime/simkl/sync` → `performSimklSync()` → normalized `SimklPersonalEntry[]` persisted to `animes_SIMKL.json` via `upsertSimklEntries()` (cache invalidated).
2. `/api/anime/animes` → `getAnimeForDisplay()` joins SIMKL entries by MAL id and computes `discrepancy` per record.
3. API handler applies filters (incl. optional `discrepanciesOnly`) and sort (MAL-authoritative via `getEffectiveStatus`).
4. `AnimeTable` / `AnimeCardView` render the SIMKL chip + `SimklDiscrepancyBadge` where present.

## Error handling

- Not authenticated / expired SIMKL token → sync endpoint returns `401`; Account UI prompts reconnect.
- SIMKL `rate_limit` (per-user write lock — shouldn't hit us on reads, but guard anyway) or transient `5xx` → surface a friendly error in the sync result; do not corrupt the watermark (only advance it after a successful merge).
- Malformed / partial item (missing `mal` id) → skip + count as orphan, never throw.
- Watermark is advanced **only after** a successful persist, so a failed sync is safely retryable.

## Testing / verification

No automated tests in this project. Verification is manual via the dev server:
- Connect SIMKL, run initial sync, confirm `animes_SIMKL.json` populated and orphan count logged.
- Confirm merged chip + badges render on cards/table for titles present in both.
- Toggle "discrepancies only" and confirm the list narrows to mismatches.
- Deliberately create a mismatch (different score/status on SIMKL) and confirm it surfaces.
- Re-run sync with no SIMKL changes → confirm `noop` (watermark short-circuit).

## Out-of-scope reminders

Tags, MAL-internal discrepancies, effective-status flip to SIMKL, and cron wiring are deferred (see "Non-goals" above).
