# H1 — Split MAL personal state out of the catalog payload

> A **design + implementation spec** for PROVIDER-PARITY.md task **H1**.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `Todo`** — approved 2026-07-21.
> Implements [PROVIDER-PARITY.md](../../PROVIDER-PARITY.md) §H1; unblocks
> [DATA-LAYOUT.md](../../DATA-LAYOUT.md)'s `personal/` folder rule.

## 1. Problem

MAL is the one personal-list provider whose personal state (`my_list_status`)
lives **inside** its catalog payload (`MALAnime`) inside the catalog file
(`animes_mal.json`). Every other provider stores personal state in its own slice
(`SimklPersonalEntry`/`animes_simkl.json`, `AniListPersonalEntry`/
`animes_anilist_personal.json`, `LocalPersonalEntry`/`animes_local_personal.json`).

The embedding is legacy, not design — AniList's API also ships catalog + list
status together yet is split into two files, so a combined API does not force a
combined file. Three concrete costs (PROVIDER-PARITY.md §H1):

- **A rating write rewrites 39 MB.** `malWriter.writeLocal` →
  `getAllAnime()` → mutate → `saveAnime()` serializes the entire catalog to
  record one score, and bumps `animes_mal.json`'s mtime, invalidating the parse
  cache and every assembled row. The tier board's serial queue does this per drag.
- `MALAnime` cannot be typed as pure catalog.
- MAL's `present` cannot mean "the slice has an entry" (its slice exists for
  every catalogued title), forcing the `!!status` carve-out.

### Measured ground truth (real store, 2026-07-21)

`animes_mal.json` = **39.2 MB / 25,382 rows**; **669** carry `my_list_status`,
all with a real status, **0** empty-status artifacts. The extracted slice is
~100 KB. So the split removes ~100 KB from a 39 MB write path.

## 2. Decisions (approved)

1. **Entry shape = verbatim MAL field names.** `MALPersonalEntry` is a type alias
   of the existing `MALListStatus` (`{ status, score, num_episodes_watched,
   is_rewatching, updated_at }`). One shape, two roles: `MALListStatus` stays the
   **wire** type on `MALAnime.my_list_status` (MAL's API returns it inline);
   `MALPersonalEntry` is the **stored** type in the new slice. No field renames
   ride on the data migration.
2. **Split on ingest.** `upsertAnime` strips `my_list_status` off each incoming
   `MALAnime` before writing the catalog, and routes the stripped status into the
   personal slice. Preserves today's behavior (seasonal/big-sync fetches persist
   the user's status) while making `animes_mal.json` pure catalog.
3. **Refuse to start on an un-migrated store.** New code that finds an embedded
   `my_list_status` in the catalog throws a clear error rather than silently
   reading an empty store. (Mechanism nuance in §7.)
4. **Each provider's episode total is its own catalog's count.** Fixing the
   `catalogEpisodes = mal.num_episodes` inconsistency exposed by the split: MAL
   personal is judged against MAL's count, AniList personal against AniList's
   count, `local` against AniList's (the main catalog), SIMKL against its own.

## 3. Data model changes (`src/models/anime/index.ts`)

```ts
/**
 * MAL's personal-list entry, now in its OWN slice (animes_mal_personal.json,
 * keyed by canonical id) — the peer of SimklPersonalEntry / AniListPersonalEntry
 * / LocalPersonalEntry. Structurally identical to the wire shape MAL's API ships
 * inline on `MALAnime.my_list_status`, so it is a type alias rather than a second
 * maintained shape.
 */
export type MALPersonalEntry = MALListStatus;
```

- `MALAnime.my_list_status` **stays on the type** — it is the MAL API wire shape,
  present on every seasonal/single-title fetch. Its doc comment gains: *"transient
  / ingest-only — `upsertAnime` strips it into the MAL personal slice; it is never
  persisted to the catalog file."*
- `AnimeSources` gains `malPersonal?: MALPersonalEntry`. `sources.mal` stays the
  raw catalog `MALAnime` (now without a meaningful `my_list_status`).

## 4. Store layer (`src/lib/store.ts`)

New slice constant + helpers, mirroring the local-slice trio:

```ts
const ANIME_MAL_PERSONAL_FILE = dataFile('animes_mal_personal.json');

export function getAllMalPersonal(): Record<string, MALPersonalEntry>;
export function upsertMalPersonal(byCanonicalId: Record<string, MALPersonalEntry>): void; // clears cachedAnime
export function removeMalPersonal(canonicalIds: string[]): void;                          // clears cachedAnime
```

**`upsertAnime` splits on ingest:**

```ts
export function upsertAnime(newAnime: MALAnime[]): void {
  if (newAnime.length === 0) return;
  const existingAnime = getAllAnime();
  const ids = resolveCanonicalIds(newAnime.map(a => ({ mal: a.id }))).ids;

  const upserts: Record<string, MALPersonalEntry> = {};
  const clears: string[] = [];
  newAnime.forEach((anime, i) => {
    const { my_list_status, ...catalog } = anime;   // strip personal off catalog
    existingAnime[ids[i]] = catalog as MALAnime;
    if (my_list_status?.status) upserts[ids[i]] = my_list_status;
    else clears.push(ids[i]);                        // mirror full-overwrite: absent status clears
  });

  saveAnime(existingAnime);
  upsertMalPersonal(upserts);   // no-op on empty
  removeMalPersonal(clears);    // no-op unless an entry actually existed
}
```

Two points, both behavior-preserving:

- Only a **statused** incoming entry is persisted — an empty-status inline
  artifact is dropped, not stored (mirrors `providerStateFromMal` already treating
  empty status as absent). Consistent with the migration (§7).
- **Absent status clears** any existing entry. Today `existingAnime[id] = anime`
  is a full object replace, so a fetch that returns a title *without*
  `my_list_status` (e.g. after the user removed it from their MAL list) drops the
  stored status. `removeMalPersonal(clears)` reproduces that exactly, scoped to the
  batch. `clears` is mostly unstatused seasonal titles that never had an entry, so
  `removeMalPersonal` writes only when something genuinely changed. Every
  `upsertAnime` caller is an authenticated MAL fetch that carries the user's status
  inline (big-sync, historical crawl, `mal/sync`, single-title refresh), so this
  never wipes a still-listed title.

**`updatePersonalStatus` / `updatePersonalStatusBatch` rewrite to the personal
slice.** They currently mutate the catalog (`getAllAnime`/`saveAnime`). New shape:
resolve MAL id → canonical (read-only, as today — "don't insert" stays: an
unresolvable MAL id, or a canonical id with no catalog row, is skipped), then
upsert into `getAllMalPersonal()`. The diff/change-tracking output is preserved.
This is the path `mal/sync.ts` drives, so the 39 MB rewrite dies here too.

**`assembleDisplayRow` / `getAnimeForDisplay` read the new slice:**
- `getAnimeForDisplay` calls `getAllMalPersonal()` and adds it to the `inputs`
  cache-key array (8 items today → 9) so a personal edit still invalidates the
  row cache by identity.
- The canonical-id union already covers the personal slice's keys implicitly
  (every entry's key is a canonical id with a catalog row); no union change
  needed, but add `...Object.keys(malPersonalByCanonical)` for symmetry/safety.
- `assembleDisplayRow` looks up `malPersonal = malPersonalByCanonical[canonicalId]`
  and threads it into both `buildProviderStates(...)` and `toAnimeRecord(...)`.
- `getAnimeByCanonicalId` gains the same `getAllMalPersonal()` read.

## 5. Extractor (`src/lib/personalState.ts`) — uniform per-provider totals

`RawPersonalSlices` gains **two** fields:

```ts
export interface RawPersonalSlices {
  mal?: MALAnime;                 // catalog — consulted ONLY for num_episodes now
  malPersonal?: MALPersonalEntry; // NEW — the personal read
  simkl?: SimklPersonalEntry;
  anilist?: AniListPersonalEntry;
  local?: LocalPersonalEntry;
  anilistMeta?: AniListMetaEntry; // NEW — to reach AniList's catalog episode count
}
```

`providerStateFromMal` takes the personal entry + MAL's episode count:

```ts
export function providerStateFromMal(
  entry?: MALPersonalEntry,
  malEpisodes?: number
): ProviderPersonalState | undefined {
  if (!entry) return undefined;
  return {
    status: entry.status ? (entry.status as UserAnimeStatus) : undefined,
    score: entry.score ? entry.score : null,
    progress: entry.num_episodes_watched ?? null,
    total: malEpisodes ?? null,
    present: !!entry.status,   // carve-out STAYS — see §6
  };
}
```

`buildProviderStates` sources each total from the provider's own catalog:

```ts
export function buildProviderStates(slices: RawPersonalSlices, precedence) {
  const { mal, malPersonal, simkl, anilist, local, anilistMeta } = slices;
  const malEpisodes = mal?.num_episodes;
  const anilistEpisodes = anilistMeta?.catalog?.numEpisodes;

  const all = {
    mal:     providerStateFromMal(malPersonal, malEpisodes),
    simkl:   providerStateFromSimkl(simkl),
    anilist: providerStateFromAnilist(anilist, anilistEpisodes),  // was malEpisodes
    local:   providerStateFromLocal(local, anilistEpisodes),      // was malEpisodes; main catalog = AniList
  };
  // …precedence filter unchanged
}
```

`providerStateFromAnilist` / `providerStateFromLocal` keep their two-arg
signatures; only the value passed changes. SIMKL stays one-arg (self total).

**Why this is correct:** `total` exists solely for the fully-watched
reconciliation — "watched all of *its own* total isn't a progress disagreement".
"Its own" must mean the provider's own catalog view. Sourcing everyone's total
from MAL made "MAL 12/12 vs SIMKL 13/13 agree" accidentally correct (both vs
MAL's 12) rather than correct per provider. It also hardcoded MAL as catalog
authority in the exact spot the provider-free direction declares AniList the
catalog.

**As shipped — a companion fix the delta forced.** Measuring the delta (per §10.3)
showed the total change is NOT inert on its own: AniList's catalog episode count
is often `undefined`, and an unknown total resurfaced a raw progress difference
between two *completed* entries (MAL 1/1 vs AniList 24/?) as 4 phantom
disagreements. Fixed at the root in `discrepancy.ts`: the fully-watched exception
now treats **`status === 'completed'` as fully-watched whatever the episode
count** (a completed title is watched in full by definition). With that clause the
per-provider-total change is verified inert — 0 discrepancy-block changes across
25,382 rows — and strictly more correct for unknown totals.

## 6. `toAnimeRecord` (`src/lib/animeUtils.ts`)

`RawAnimeSlices` gains `malPersonal?: MALPersonalEntry` (it already carries
`anilistMeta`). `toAnimeRecord`:
- passes `malPersonal` + `anilistMeta` into `buildProviderStates`;
- sets `sources.malPersonal = malPersonal` on the assembled record;
- `sources.mal = mal` unchanged.

The hydrated `personal` block is unchanged in *derivation* (still `toAnimePersonal`
over the provider states) — only its MAL input now comes from `malPersonal`
instead of `mal.my_list_status`.

**The `!!status` presence carve-out STAYS.** PROVIDER-PARITY.md §H1 claims the
carve-out "evaporates" once the file is split. It does not — with split-on-ingest,
a MAL fetch can still seed a statused entry and a future score-only local write
could still leave a `{ status: '' }` shape, so presence-by-`!!status` remains
the safe rule. The spec corrects the doc's overclaim rather than removing the
carve-out (see §9).

## 7. Migration + boot guard

### 7.1 Migration script — `scripts/migrate-mal-personal.js`

Modeled on `scripts/migrate-canonical.js` (dry-run, explicit refusal, idempotent).

```
node scripts/migrate-mal-personal.js <dataPath> [--dry-run]
DATA_PATH=/path node scripts/migrate-mal-personal.js [--dry-run]
```

Per the write-verify-remove discipline:
1. Read `animes_mal.json`.
2. Build `animes_mal_personal.json` = `{ canonicalKey → my_list_status }` for
   every row whose `my_list_status.status` is non-empty (drop empty-status
   artifacts — they are not personal state, matching ingest §4).
3. Write the personal file; verify it parses and the entry count matches.
4. Rewrite `animes_mal.json` with `my_list_status` stripped from every row.

**Idempotency:** a catalog already free of `my_list_status` → treated as migrated
(no-op). Keys are the row's existing canonical key (the catalog is already
canonical-keyed post the canonical-id migration), so no id resolution is needed.

**Refuse:** anything unexpected (catalog not canonical-keyed; personal file
already exists with disagreeing entries) reports and exits non-zero.

### 7.2 Boot guard

There is **no central process-boot hook** (no `instrumentation.ts`; `next.config.js`
has none). So "refuse to start" is implemented as a **one-time lazy guard on the
first store read**, not a true boot check — same user-visible effect (the app
errors loudly instead of rendering an empty store).

- A module-level `assertMigratedMalStore()` in `store.ts`, called at the top of
  `getAllAnime()` (and `getAllMalPersonal()`), guarded by a module boolean so it
  runs once per process.
- It reads the already-parse-cached catalog and checks whether **any** row still
  carries `my_list_status`. New code never writes it there, so its presence is an
  unambiguous "un-migrated" signal. On hit: `throw new Error('Un-migrated MAL
  store: my_list_status still embedded in animes_mal.json — run
  scripts/migrate-mal-personal.js')`.
- Cost: one pass over the parsed rows, once. The parse itself is already paid by
  the caller. File-existence was rejected as the signal (a MAL user who synced
  seasons containing none of their listed titles would have no personal file yet,
  false-positiving).

## 8. Consumer updates

| File | Change |
|---|---|
| `src/pages/anime/[id].tsx` | `anime.sources.mal?.my_list_status` → `anime.sources.malPersonal` (detail display `mal` variable at line ~99). |
| `src/lib/personalWriters.ts` | `malWriter.writeLocal` bumps the personal slice via `getAllMalPersonal()`/`upsertMalPersonal` instead of `getAllAnime()`/`saveAnime()`. Empty-status seed `{ status: '', … }` only when neither status nor score/progress is set; a `status: null` clear removes the entry (or sets empty status — matches `!!status` presence). Kills the per-drag 39 MB rewrite. |
| `src/lib/mal.ts` | Unchanged — `fetchUserAnimelist` still emits `{ animeId, listStatus }`; `MAL_ANIME_FIELDS` still requests `my_list_status` (it is how the status arrives to be split on ingest). |
| `src/pages/api/anime/mal/sync.ts` | Unchanged — still calls `updatePersonalStatusBatch`, which now lands in the personal slice. |
| `src/pages/api/anime/animes/[id]/refresh.ts` | Unchanged — `refreshMal` calls `upsertAnime([{ ...existing, ...fetched }])`, which now splits on ingest. `existing` is the catalog row (no `my_list_status`); `fetched` carries the fresh `my_list_status`, which is routed to the personal slice. Correct by construction. |

## 9. Docs

- **CLAUDE.md**: add `animes_mal_personal.json` to the data-storage list; update
  the H1 references and the "MAL alone embeds it" framing. Note the personal
  precedence / `personalState.ts` sections that mention `mal.my_list_status`.
- **PROVIDER-PARITY.md §H1**: flip to `Done 2026-07-21`; **correct** the
  "presence exception evaporates" claim to "the carve-out stays; the file split
  removes the 39 MB write and lets `MALAnime` be typed as catalog" (the two costs
  that *do* resolve). Note the per-provider-total fix shipped alongside.
- **DATA-LAYOUT.md §2**: note H1 is done — `personal/` now has its fourth file.

## 10. Verification

`next dev` does not hydrate — verify against a production build, and refresh the
local store first (`npm run data:copy-salon`, per memory).

1. **Type/lint**: `npm run build` (CSS types + `next build`) and `npm run lint`.
2. **Migration inertness**: run `migrate-mal-personal.js --dry-run` on a copy;
   confirm 669 entries extracted, catalog rewritten with 0 remaining
   `my_list_status`, and re-run is a no-op.
3. **Discrepancy inertness**: before/after diff of every row's `discrepancy`
   block across the real store (25,382 rows), the way A1 verified. The
   per-provider-total change (§5) can shift AniList/local flags — **report the
   delta**, don't assume zero. Expect movement only where AniList's own episode
   count differs from MAL's for a title the user has on both lists.
4. **Effective reads unchanged**: hydrated `personal` block diff across all rows
   = 0 changes for a MAL-connected user (the MAL input moved files, not values).
5. **Live smoke** (production build): a tier-board drag writes the score, the
   `animes_mal.json` mtime does **not** change (only the personal slice does),
   the value holds after reload, and the detail page shows the same status.
6. **Boot guard**: point the built app at an un-migrated copy → it throws the
   named error rather than rendering an empty list.

## 11. Out of scope

- The folder reorganization (`personal/mal.json` etc.) — [DATA-LAYOUT.md](../../DATA-LAYOUT.md),
  a separate migration this unblocks but does not perform.
- Storing AniList's own episode total on `AniListPersonalEntry` (A1's follow-up).
  §5 sources it from `AniListMetaEntry.catalog.numEpisodes` instead, which is
  sufficient and needs no personal-shape change.
