# Phase 1 — The local provider (read path + enablement)

**Goal:** a local personal-data source that hydrates into the record exactly like SIMKL and
AniList, plus the settings toggle and `auto` precedence resolver. After this phase, a local
entry (created by hand or a seed script) shows through as effective status/score/progress and
seeds recommendations. **Nothing writes to it yet** — that's phase 2.

This phase also **un-conflates local edits from the MAL slice** (see README backbone): once a
`personalFromLocal` extractor exists, local edits stop needing a home inside `animes_mal.json`.

---

## 1a. New slice file + model

- **File:** `animes_local_personal.json` under `DATA_PATH`, keyed by **canonical id**.
- **Model** — new interface in [src/models/anime/index.ts](../../src/models/anime/index.ts),
  mirroring `AniListPersonalEntry`'s locked-shape style (source-pure, no `mal_id` — the store
  keys by canonical id externally):

  ```ts
  /** In-app local personal state — the write target when no external provider exists. */
  export interface LocalPersonalEntry {
    status?: UserAnimeStatus;   // MAL vocabulary
    score?: number;             // 1-10 scale; 0/undefined = unrated
    progress?: number;          // episodes watched
    updated_at: string;         // ISO — local edits are the authority, so keep a mtime
  }
  ```

- Add `local?: LocalPersonalEntry` to `AnimeSources`.

## 1b. Provenance / precedence type — mind the catalog ripple

`ProvenanceSource` is `'mal' | 'anilist' | 'simkl'`, and **`CatalogSource = ProvenanceSource`**
([models/anime/index.ts:244](../../src/models/anime/index.ts)). Adding `'local'`:

```ts
export type ProvenanceSource = 'mal' | 'anilist' | 'simkl' | 'local';
```

...makes `'local'` a nominal **catalog** source too. Do **not** split the type. Instead mirror
the existing `catalogFromSimkl` no-op:

```ts
/** Local provider contributes no catalog fields — personal-only. No-op for uniformity. */
function catalogFromLocal(): Partial<AnimeCatalog> { return {}; }
```

...and include it in the catalog extractor map so the shapes stay uniform. It never wins a
catalog field.

## 1c. Extractor + hydration wiring

In [src/lib/animeUtils.ts](../../src/lib/animeUtils.ts):

```ts
/** Local entry → AnimePersonal field names. */
function personalFromLocal(entry?: LocalPersonalEntry): Partial<AnimePersonal> {
  if (!entry) return {};
  return {
    status: entry.status,
    score: entry.score != null && entry.score > 0 ? entry.score : undefined,
    progress: entry.progress,
  };
}
```

- Add `local?: LocalPersonalEntry` to `RawAnimeSlices`.
- In `toAnimeRecord`, add `local` to the personal extractor map:
  `{ mal: personalFromMal(mal), simkl: personalFromSimkl(simkl), local: personalFromLocal(local), anilist: personalFromAnilist(anilistPersonal) }`
  and to the catalog map (the no-op).

## 1d. Precedence: resolve `auto`, then thread it through the store

> **This is the phase's trickiest wiring — precedence is not threaded today.** `toAnimeRecord`
> accepts a `personalPrecedence` param but every caller uses the default.

**Default arrays** (animeUtils.ts) — where does local sit relative to SIMKL/MAL/AniList? Local
edits are the most deliberate signal, so when local is a live source it should win:

```ts
// SIMKL > MAL > AniList unchanged; local's position is chosen by the resolver, NOT baked here.
export const DEFAULT_PERSONAL_PRECEDENCE: ProvenanceSource[] = ['simkl', 'mal', 'anilist'];
```

**Resolver** — a small pure function that turns `precedenceMode` + "which providers are
writable/present" into an ordered array:

```ts
// resolveLocalPrecedence('localTop',   base) => ['local', ...base]
// resolveLocalPrecedence('localBottom', base) => [...base, 'local']
// resolveLocalPrecedence('auto', base, { hasWritableExternal }) =>
//     hasWritableExternal ? [...base, 'local']   // bottom: never shadows an external edit
//                         : ['local', ...base]    // top: local is the only real source
```

Keep this **pure and client-safe** if the settings page needs to preview the resolved order
("Auto — currently: local wins").

**Threading into the store** — in [src/lib/store.ts](../../src/lib/store.ts):

1. Read `animes_local_personal.json` in `getAnimeForDisplay` (add `getAllLocalEntries()`
   alongside `getAllSimklEntries()`), pass the slice into `assembleDisplayRow`, and add its
   keys to the `canonicalIds` union.
2. Compute the effective precedence once (from the resolved `precedenceMode`) and pass it as
   `toAnimeRecord`'s `personalPrecedence` arg in `assembleDisplayRow`.
3. **Row-cache invalidation** — `getAnimeForDisplay` caches on `cachedAnimeInputs` (identity of
   the parsed slices). Two additions:
   - add the local slice object to the `inputs` array (so a local write invalidates the row
     cache via the mtime parse-cache, same as every other slice), **and**
   - fold the **resolved precedence** into the cache key (e.g. include the mode string), so
     that flipping `precedenceMode` in settings — which changes *no slice file* — still
     rebuilds the rows. Miss this and a settings change silently won't take effect until a
     slice file changes.
4. Same additions in `getAnimeByCanonicalId` / `assembleDisplayRow` (it already takes the
   slices as params — add `local`).

**Store slice accessors** (store.ts), mirroring the SIMKL ones:

```ts
export function getAllLocalEntries(): Record<string, LocalPersonalEntry> { ... }
export function upsertLocalEntries(...) { ... }   // used by phase 2's writer
```

## 1e. Settings

Extend [src/lib/settings.ts](../../src/lib/settings.ts) — but note the current `AppSettings` is
all `string` secrets with an env fallback. The two new fields are **not** secrets and have **no
env backing**, so either:

- add them to `AppSettings` and special-case them out of `SETTINGS_ENV_MAP`/`SECRET_FIELDS`, or
- (cleaner) add a small **non-secret settings** section so the enum/boolean fields don't have
  to pretend to be redacted strings.

Fields:

```ts
localProviderEnabled?: 'auto' | 'on' | 'off';         // default 'auto'
localPrecedenceMode?: 'auto' | 'localTop' | 'localBottom'; // default 'auto'
```

- **`hasWritableExternal` predicate** — a server-side helper (in `settings.ts` or a small
  `providers.ts`): true iff a MAL token exists OR a SIMKL token exists (extended per registered
  writer in phase 2). `localProviderEnabled === 'auto'` resolves to `!hasWritableExternal`.
- Surface both in the **`/settings` page** with the resolved value shown next to `auto`
  ("Auto — actuellement : local activé (aucun fournisseur externe)").
- `GET /api/anime/settings` returns them plainly (not secrets).

## Touch list (Phase 1)

- [src/models/anime/index.ts](../../src/models/anime/index.ts) — `LocalPersonalEntry`,
  `AnimeSources.local`, `ProvenanceSource` += `'local'`.
- [src/lib/animeUtils.ts](../../src/lib/animeUtils.ts) — `personalFromLocal`, `catalogFromLocal`
  no-op, both extractor maps, `RawAnimeSlices.local`, precedence resolver.
- [src/lib/store.ts](../../src/lib/store.ts) — `getAllLocalEntries`/`upsertLocalEntries`, read +
  union + pass into `assembleDisplayRow`, resolved precedence, **both** row-cache additions.
- [src/lib/settings.ts](../../src/lib/settings.ts) — two new non-secret fields +
  `hasWritableExternal`.
- [src/pages/api/anime/settings/index.ts](../../src/pages/api/anime/settings/index.ts) — echo
  new fields.
- `/settings` page UI — two controls + resolved-value hint.

## Verification

- **Regression (you):** with MAL/SIMKL present and `localProviderEnabled='auto'`, no
  `animes_local_personal.json` is read as authority; effective values identical to today.
- **Local-only:** on an empty external setup, hand-write one `animes_local_personal.json`
  entry → the record's effective status/score/progress reflect it, and it appears as a reco
  seed if `completed` + high score.
- **Precedence flip:** change `localPrecedenceMode` in settings → rows rebuild without any
  slice file changing (proves the cache-key fold in 1d.3).
