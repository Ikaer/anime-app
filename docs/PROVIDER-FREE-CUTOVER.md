# Provider-free cutover — execution plan

> **Execution / tracking doc** for landing the provider-neutral record end to end.
> The *design* lives in [PROVIDER-FREE.md](PROVIDER-FREE.md) (north star, provider
> feasibility, target model) and [PROVIDER-ABSTRACTION.md](PROVIDER-ABSTRACTION.md)
> (why the wiring-layer registry was dropped). This doc is the *how* and the
> *order*: the phased, green-checkpointed path to a store and a record with **no
> MAL id and no MAL shape anywhere outward or at rest**.
>
> Status vocabulary: `Todo` · `WIP` · `Done` · `Blocked`
> Overall: `WIP` (Phase C)
>
> **Doc hygiene:** this file stays pristine — the only edits are ticking the
> phase checkboxes and bumping the status line to track progress. No changelog,
> no inline notes, no "done/learned" annotations appended here. Anything worth
> noting for later goes in its own file under `docs/provider-free-cutover/`.

---

## Goal (what "done with this part" means)

1. The **synthetic canonical id is the only identity** — the key of every store
   file, the id on the record, the id in every URL / route param / React key. The
   MAL id survives **only** as one entry in the crosswalk (`sources.mal.id` /
   `crosswalk.mal`), used solely to call MAL's/SIMKL's APIs.
2. The local record is **one provider-neutral shape** (`AnimeRecord`) — no
   `extends MALAnime`, no top-level `mean`/`title`/`my_list_status`. Catalog and
   personal fields are **hydrated field-by-field across providers** with a
   configurable precedence, and every field records **where it hydrated from**
   (provenance).
3. **AniList is a first-class catalog provider with no key**: from an empty
   store, running the AniList crawl renders real rows — with posters — in the
   main list. (This is the concrete acceptance test; see [Verification](#verification-anchor).)
4. **No compat shim survives.** Coordinated cutover (data migration is
   acceptable, per PROVIDER-FREE "Decisions locked"). A transient red build
   during a phase is the compiler-generated worklist; a *lingering* MAL-keyed
   layer is the thing we are removing and must not remain.

Deferred (explicitly out of scope, unchanged from PROVIDER-FREE): AniList titles
with **no `idMal`** — they have no way to seed identity from an existing MAL id,
and pulling anilist-id-only titles into the join is its own follow-up. Every
title with an `idMal` is fully in scope.

---

## Target architecture

### Storage — everything keyed by canonical id

The registry is promoted from "one file among many" to **the identity spine**.
Every other file is a slice hanging off it.

| File | Before (key) | After (key) | Shape |
|---|---|---|---|
| `animes_registry.json` | canonicalId | canonicalId (unchanged) | `Record<canonicalId, SourceIds>` — **durable identity anchor** |
| `animes_mal.json` | MAL id | **canonicalId** | `Record<canonicalId, MALAnime>` (raw MAL slice) |
| `animes_simkl.json` | MAL id | **canonicalId** | `Record<canonicalId, SimklPersonalEntry>` |
| `animes_anilist_meta.json` | MAL id | **canonicalId** | `Record<canonicalId, AniListMetaEntry>` |
| `animes_anilist_personal.json` | MAL id | **canonicalId** | `Record<canonicalId, AniListPersonalEntry>` |
| `animes_hidden.json` | MAL id[] | **canonicalId[]** | `canonicalId[]` |
| `recommendations_feedback.json` | MAL id | **canonicalId** | `Record<canonicalId, 'up'\|'down'>` |

Reco cache / sync checkpoints hold provider-side data (crowd edges by `idMal`,
SIMKL watermark) and are re-keyed to canonical only where they carry app-facing
ids (feed candidate ids, seed ids — see Phase D).

### Identity resolution at ingest (the new invariant)

Sources arrive keyed by **provider** id (MAL sync → mal ids; AniList → `idMal`
or anilist id; SIMKL → its `ids` block incl. mal). Writes therefore go through a
single resolver:

```
resolveCanonicalId(providerIds: SourceIds): canonicalId
  1. look up the registry by mal → anilist → simkl (first hit wins)
  2. found  → merge any new provider ids into that entry's crosswalk, return it
  3. missing → MINT a new canonical id, seed its crosswalk, return it
```

- **Resolve-before-mint is mandatory.** A sync must never blind-mint a new id for
  a title the registry already anchors, or durable user data (feedback/hidden,
  keyed by canonical id) silently reattaches to the wrong title on the next
  rebuild. Every write path calls the resolver first.
- **The registry is durable and survives rebuilds.** "Rebuild my catalog"
  re-crawls source *data* but **preserves the registry**, so canonical ids are
  stable. Only an explicit hard reset deletes it. A monotonic counter id
  (`a_<n>`, as today) is safe *because* of this invariant, not on its own.
- **Collision policy:** when two provider ids would merge into conflicting
  canonical entries (MAL splits AniList merges, or vice-versa), the migration /
  resolver **detects and reports** (does not silently merge). Same stance
  PROVIDER-FREE Phase 1 set.

### The one record shape

Collapse `MALAnime`-extending `MergedAnime` + `AnimeForDisplay` + `AnimeRecord`
into a **single** `AnimeRecord` (the three-way coexistence is itself "mal bits
here and there"):

```ts
interface AnimeRecord {
  id: string;                 // canonical id — the ONLY id, outward and internal
  crosswalk: SourceIds;       // { mal?, anilist?, simkl?, ... } — provider ids
  catalog: AnimeCatalog;      // hydrated across providers (below)
  personal: AnimePersonal;    // hydrated across providers (SIMKL>MAL>AniList)
  sources: AnimeSources;      // raw per-provider slices: { mal?, simkl?, anilistMeta?, anilistPersonal? }
  provenance: RecordProvenance; // per-field origin
  hidden?: boolean;
  discrepancy?: Discrepancy | null;
}
```

`AnimeForDisplay` is retired as a distinct interface (kept only as a transitional
type alias, removed by Phase E). Reco items are `AnimeRecord & { recoMeta }` via a
generic, as today.

### Hydration engine (generalizes `getEffective*` + banner + `resolveCatalogField`)

One mechanism, used for both catalog and personal:

- Each provider exposes a **`Partial<AnimeCatalog>`** (and `Partial<AnimePersonal>`)
  extractor: `catalogFromMal(mal)`, `catalogFromAnilist(meta)`, … SIMKL is a
  no-op catalog contributor today but is wired uniformly.
- A generic merge walks each field, picks the **first source in the precedence
  order that has a defined value**, and records that source in a sibling
  **provenance** map (`provenance.catalog.title = 'anilist'`). Values stay flat
  (`record.catalog.title` is the string) so no consumer reads `.value`.
- **Precedence is configurable**: a global default order + optional per-field
  overrides. Defaults: catalog **MAL-first** (AniList wins only where MAL is
  absent — satisfies the "title only in AniList → use AniList" case without
  blanking not-yet-crawled titles); personal **SIMKL > MAL > AniList** (exactly
  today's `getEffective*`). `getEffectiveStatus/Score/Progress` become thin
  reads of `record.personal.*` (or are deleted, callers moved to `.personal`).
- Banner art (`bannerImage`) is just another catalog field, AniList-sourced.

---

## Phases (each ends on a green build + a checkpoint)

### Phase A — Identity resolution + durable registry `Done`

Make ingest resolve-before-mint; make AniList ingest actually touch the registry.

- [x] Registry gains `anilist`/`simkl` indices alongside the existing mal index.
- [x] `resolveCanonicalId(SourceIds)` in `store.ts` (mint-or-resolve, updates crosswalk).
- [x] AniList catalog crawl routes through the resolver — no blind mint.
      *(The rest of the writers — `upsertAnime`/`upsertSimklEntries`/
      `upsertAnilistMeta`/hidden/feedback — still rely on the lazy self-heal;
      converting them to resolve-at-write is Phase B, since it only becomes
      load-bearing once the files are canonical-keyed and the lazy reconcile is gone.)*
- [x] Widen the AniList catalog crawl + slice so an AniList row is renderable
      (poster/format/episodes/season/status/startDate/synopsis).
- **Checkpoint:** run the AniList crawl on a scratch store; assert every result
  got a canonical id and the registry crosswalk carries its `anilist` + `mal` ids.

### Phase B — Re-key the store to canonical id + migration `Done`

- [x] Migration script (`scripts/migrate-canonical.js`): read the current
      MAL-id-keyed files, resolve each to a canonical id via the registry
      (minting once, persisting the registry), rewrite **every** slice file +
      `hidden` + `feedback` keyed by canonical id. **Idempotent / re-runnable.**
      Detect-and-report duplicate provider-id claims. *(Tested on a live-data
      copy: idempotent, atomic buffer-then-write, halts on collision. Findings +
      one blocking data decision in `docs/provider-free-cutover/migration-findings.md`.)*
- [x] `store.ts` read/write primitives operate on canonical keys; join in
      `getAnimeForDisplay` iterates **registry canonical ids** (the union of all
      sources), not `Object.values(animes_mal)`.
- **Checkpoint:** app boots on migrated data; main list renders existing MAL
  titles addressed by canonical id.

### Phase C — Hydration engine + one record shape + provenance `Todo`

- [ ] Build the engine (per-source partial extractors + generic precedence merge
      + provenance) in `animeUtils.ts`.
- [ ] `getAnimeForDisplay` / by-id build records via the engine from the gathered
      slices — an AniList-only-but-idMal title with no MAL slice produces a full
      catalog, `sources.mal` undefined.
- [ ] Drop `extends MALAnime`; collapse to one `AnimeRecord`. Migrate all raw
      readers (`applyNarrowingFilters`, sort, `getPrimaryTitle`/`animeYear`,
      `computeDiscrepancy` → `sources.mal`, the "MAL status" label → `sources.mal`,
      table/card/detail/tier/discrepancies/calculator) onto
      `catalog`/`personal`/`sources`. Compiler-driven.
- **Checkpoint (the big one):** empty store → AniList crawl → main list renders
  rows **with posters**; provenance map populated per field.

### Phase D — Outward canonical id (URLs, routes, keys, reco) `Todo`

- [ ] `/anime/[id]` + all `/api/anime/animes/[id]/*` + reco `similar/[id]` +
      `feedback/[id]`: param **is** the canonical id (store is canonical-keyed →
      direct lookup). MAL/SIMKL writes read `crosswalk.mal` / `sources`.
- [ ] Numeric (legacy MAL-id) URLs resolve → **redirect** to the canonical URL
      (bookmark preservation).
- [ ] React keys + internal links use `record.id`; MAL external links use
      `crosswalk.mal`.
- [ ] Reco engine: feed candidate ids, seeds, and `feedback` keyed by canonical;
      provider-id crowd edges (`idMal`, anilist id) resolve → canonical when
      hydrated. *(Hairiest step — `recommendations.ts` is mal-id-keyed internally
      today; resolve at the hydrate/exclude boundaries.)*
- **Checkpoint:** detail page, hide, rate (MAL+SIMKL), and the full reco feed all
  work addressed by canonical id.

### Phase E — Cleanup + docs `Todo`

- [ ] Remove the transitional `AnimeForDisplay` alias and any dead MAL-shaped code.
- [ ] Update `CLAUDE.md` (storage keys, record shape) and PROVIDER-FREE.md
      (mark the pulled-forward Phase 2/3 deferrals done).
- [ ] Final verification-anchor pass.

---

## Verification anchor (the done-check)

From an **empty** store:
1. Trigger the AniList catalog crawl.
2. The main list renders real rows **with poster images** (confirm the AniList
   `coverImage` host loads through `next/image` — `unoptimized` should cover it;
   a blocked image host guts first-run).
3. Each rendered field's `provenance` names `anilist`.
4. Re-run the crawl / a rebuild → **canonical ids unchanged**, no feedback/hidden
   reattached to a different title.

---

## Risks / watch-items

- **Reco engine (Phase D)** is the deepest MAL-id coupling; keep its internal
  crowd-edge math mal-keyed and translate at the hydrate/exclude/feedback edges.
- **`next/image` host allow-list** for AniList cover/banner CDNs.
- **Collision reporting** must be visible (log), not swallowed, during migration.
- **Id stability** across rebuilds is the one invariant that, if broken,
  corrupts durable user data silently — test it explicitly (Verification step 4).
