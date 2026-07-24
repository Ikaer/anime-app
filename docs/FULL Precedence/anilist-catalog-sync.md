# Syncing the AniList catalog the way MAL already is

> **Problem E2.** AniList is nominally the catalog north star, but on a MAL-seeded
> store **0 of 19,297** AniList entries carry a `catalog` block. Nothing in the
> precedence work is observable until this is fixed. This is the prerequisite for
> everything else in this folder.

## Why the data is missing

`catalog/anilist.json` entries are written by two different jobs, and only one of
them writes catalog fields:

| Job | Writes | Covers |
|---|---|---|
| **Meta sync** (`performAnilistMetaSync`) | `tags`, `staff`, `banner_image`, `relations` | every title — **19,297 entries** |
| **Catalog crawl** / `fetchAnilistCatalogByMalIds` | the `catalog` block | only titles it happens to touch — **0 here** |

The catalog-writing paths both target titles that **lack a MAL id**:

- `performAnilistBulkCatalogCrawl` / the season crawler — the *keyless onboarding*
  path, which seeds the registry from AniList when there is no MAL account.
- `fetchAnilistCatalogByMalIds` — reco candidate hydration, called only for
  candidates with **no local record** (`reco/refresh.ts`).

This store is MAL-seeded and every title already has a MAL record, so neither
path ever fired for them. The meta sync that *did* run across all 19,297 titles
simply does not fetch catalog fields.

**So this is not a bug** — it is a missing job. The design assumed AniList catalog
fields only mattered for AniList-only titles.

## What already exists (most of it)

This is the smallest of the three problem docs because the hard parts are built:

- **`CATALOG_FIELDS`** — the GraphQL field set, already shared by the season
  crawler and the by-MAL-id path *specifically so the two cannot drift into
  producing differently shaped rows*. Reuse it; do not write a third field list.
- **`fetchAnilistCatalogByMalIds(malIds, onProgress)`** — batches 50 ids per
  request, normalizes to MAL vocabulary at crawl time (`mediaType` lowercase,
  `airingStatus` = `finished_airing|currently_airing|not_yet_aired`, `startDate`
  = `YYYY-MM-DD`, `mean` = `averageScore/10`), and persists via
  `upsertAnilistCatalogFields`.
- **`upsertAnilistCatalogFields`** — merges the `catalog` block rather than
  overwriting the entry, so tags/staff/banner/relations survive. Resolves-before-mint
  internally.
- **Throttling** — the shared module-level slot allocator in `anilist/client.ts`.
  Carry **no** `setTimeout` pacing of your own; that is the mistake LIB-REORG F4
  removed.

## What is missing

1. **A sweep driver** — `performAnilistCatalogSweep()`, selecting every registry
   title whose AniList entry has no `catalog` block.
2. **An endpoint + a Connections-page button** — `POST /api/anime/anilist/catalog-sweep`,
   fire-and-forget, in the **Catalogue** role group (auth kind `anonymous`, so it
   needs no account — that is the whole point of AniList's catalog role).
3. **Cron wiring** — a step in `cron-sync.ts` so it stays current as MAL's crawl
   adds titles.

## Design constraints

**Keep it a separate query from `TAGS_QUERY`.** The tags+staff+banner query is
already verified to sit *near* AniList's complexity ceiling, and staff must stay
nested in `Page.media`. Stacking catalog fields on it risks null-bombing the sweep
that currently works. `RECS_QUERY` is kept separate for exactly this reason —
follow that precedent.

**Backfill signal is `catalog === undefined`.** Same idiom as `staff` /
`banner_image` / `relations`: a missing field means "never fetched", so already-swept
titles are not re-queued. Note the asymmetry with `banner_image`, which is written
as explicit `null` when absent — a *title* AniList does not have simply gets no
entry, so no equivalent sentinel is needed here.

**Resumable by construction.** Persist after every batch, like the cast sweep —
an interrupted run must lose nothing. A ~19k-title sweep at ~28 req/min ÷ 50 per
request is roughly **15–20 minutes**; it *will* be interrupted at some point.

**Two id spaces, homogeneous batches.** A batch carries exactly **one** id filter,
because AniList applies a supplied-but-null argument as a real filter. Which id
space to prefer is the subject of the next section — do **not** copy
`selectMetaTargets`' current priority.

**Progress via `appendLog('anilist-catalog-sweep', …)`**, polled by the connection
log panel. No SSE — same pattern as meta-sync, cast sweep and the catalog crawl.

**Skip gracefully.** AniList does not have every MAL title; a miss is not an error.

## Id-space policy — query AniList by AniList's id

**AniList methods take AniList ids, from the crosswalk. Full stop.** Enriching
AniList *by MAL id* is a hard coupling: it makes MAL's identifier load-bearing for a
provider that has its own, and routes an exact lookup through a foreign key.

### The current code has the priority backwards

```ts
// selectMetaTargets() — anilist/sync.ts
const malId = toNum(crosswalk.mal);
if (malId !== undefined) { malIds.push(malId); continue; }   // ← MAL wins unconditionally
const anilistId = toNum(crosswalk.anilist);
if (anilistId !== undefined) anilistIds.push(anilistId);     // ← AniList only as fallback
```

The AniList id is used **only when there is no MAL id** — so a title whose AniList
id we already hold is still fetched through `idMal_in`. The two-id-space machinery
(`MetaIdSpace`, `fetchTagsBatch(batch, by)`, `refreshAnilistMetaForIds(ids, by)`)
already exists and works; only the *priority* is wrong.

### Target policy

```ts
const anilistId = toNum(crosswalk.anilist);
if (anilistId !== undefined) anilistIds.push(anilistId);
// No AniList id in the crosswalk ⇒ AniList does not enrich this title.
// It is NOT looked up by MAL id. Coverage is the season crawl's job.
```

The `malIds` half of `selectMetaTargets` disappears, and with it the `MetaIdSpace`
branching in the sweep — one id space, one query shape.

### `idMal` as a query key goes away entirely — there is no bridge

The tempting objection is *"the crosswalk's AniList id is itself produced by an
`idMal` lookup, so the bridge has to stay."* **That is wrong**, and the distinction
it misses is the whole design:

| | What it is | Verdict |
|---|---|---|
| `Media(idMal: 456)` — **querying AniList by MAL's id** | a foreign key used as AniList's primary lookup key | **Coupling. Remove.** |
| `idMal` read off an **AniList-native result** | AniList declaring its own crosswalk, as data | **Fine — this is reconciliation.** |

AniList ids enter the crosswalk through **AniList-native discovery**, not through a
MAL lookup. `performAnilistBulkCatalogCrawl` browses AniList **by season**, and
`CATALOG_FIELDS` already selects **both `id` and `idMal`** on every result. One
AniList-native call therefore yields `{anilist: 123, mal: 456}`, and
`resolveCanonicalId` reconciles that against the registry. The MAL id arrives *as a
field on AniList's own payload* — never as a query key. The crawler already
documents exactly this: titles found *with* a MAL id enrich the existing entry;
titles found *without* one are keyed off the `anilist` crosswalk alone.

### The rule

> External data arriving keyed by a provider id (crowd edges as MAL ids, say) is
> converted to **canonical ids at the boundary**. Past that boundary everything
> speaks canonical, and each provider method takes **its own** id out of the
> crosswalk — AniList methods take AniList ids, MAL methods take MAL ids.
>
> **If the crosswalk holds no id for a provider, that provider simply does not
> enrich that title.** Accepting that is what keeps the schema simple: no
> gap-bridging paths, no foreign keys promoted to primary keys.

### Measured split (2026-07-24)

| | Count | Route |
|---|---|---|
| Registry entries | 25,382 | — |
| …with an AniList id in the crosswalk | **19,297 (76%)** | `id_in` |
| …MAL id only — **not enriched by AniList** | **6,085 (24%)** | none |
| …AniList id only | 0 | `id_in` |

### Consequence: the 6,085 become a crawl-depth problem

This is the honest trade, and it is a far better problem to own:

- AniList coverage becomes a function of **how deep AniList-native crawling goes**,
  not of how cleverly MAL ids are bridged.
- Today `BULK_CRAWL_YEARS_BACK = 8`, while MAL's historical crawl reaches back to
  **1960**. *That* asymmetry — not id-space plumbing — is why 6,085 titles have no
  AniList id.
- So the fix is to **deepen the AniList season crawl** (it already accepts
  `yearsBack` as a parameter) until its window matches MAL's, then accept whatever
  AniList genuinely lacks.
- It also dissolves the negative-caching gap below: a title never found by an
  AniList-native crawl is simply never queued, instead of being re-queried by MAL id
  forever.

### Rename the entry point

`fetchAnilistCatalogByMalIds(malIds, …)` bakes a foreign id space into the name.
It takes AniList ids and says so:

```ts
fetchAnilistCatalog(anilistIds: number[], onProgress?)
```

No `by: MetaIdSpace` parameter — there is only one id space left on this path.
`refreshAnilistMetaForIds(ids, by)` keeps its parameter only for as long as
`selectMetaTargets` still has a MAL branch; both lose it together.

### The reco-refresh caller — the keyless case, and why it is self-inflicted

This is the one caller that looks like it *needs* the MAL bridge. It does not.

`reco/refresh.ts` hydrates candidates with **no local record** (so no crosswalk
entry, no AniList id), and it splits on whether a MAL account exists:

```ts
if (accessToken) {
  await fetchAnimeDetail(missing[i], accessToken);   // MAL method, MAL id — fine
} else {
  await fetchAnilistCatalogByMalIds(missing, …);     // AniList queried by MAL id — the coupling
}
```

**With a MAL account there is no problem at all**: a MAL id goes to a MAL endpoint,
exactly as the rule prescribes. The coupling exists **only on the keyless path**.

And the keyless path only has a MAL id because **we threw AniList's own id away**:

```graphql
# RECS_QUERY — anilist/sync.ts
mediaRecommendation { idMal }        # ← AniList's own `id` is NOT selected
```

In a keyless install the candidates come from `anilistCrowd` — *AniList's own
recommendation edges*. AniList hands us each recommended title's native id, the
query discards it, keeps only `idMal`, and hydration is then forced to ask AniList
*back* by MAL id. There was never a missing identifier; it was dropped on the floor.

### The fix (E11) dissolves the question

Select AniList's id and keep it:

```graphql
mediaRecommendation { id idMal }
```

Then each path uses its own provider's id and the bridge disappears entirely:

| Install | Candidate source | Id held | Hydrated by |
|---|---|---|---|
| MAL connected | MAL crowd edges + suggestions | MAL id | `fetchAnimeDetail` (MAL) |
| Keyless | `anilistCrowd` | **AniList id** | `fetchAnilistCatalog` (AniList) |

**Bonus — a real coverage gain, not just tidiness.** `fetchAnilistRecommendations`
currently drops *"recs AniList couldn't map to a MAL id"*. Those are exactly the
AniList-only titles a keyless install exists to surface, and they are discarded
today because the pipeline has nowhere to put a title without a MAL id. Keeping
`id` makes them first-class candidates.

Do **not** reintroduce `Media(idMal:)` here.

### Related: a negative-caching gap that this dissolves

`selectMetaTargets`' `needed` predicate is `!e || e.staff === undefined || …`, so
today the **6,085** titles with no AniList entry are re-queued on **every**
meta-sync run — ~122 requests per run that always miss and never converge.

Dropping the MAL branch removes the loop at its source: those titles have no
AniList id, so they are never queued at all. Their coverage becomes the season
crawl's responsibility, which is where it belongs. **No "looked, found nothing"
sentinel is needed** — absence from the crosswalk already carries that meaning.

## Acceptance test

1. Run the sweep on the live store.
2. Re-run the measurement from [README.md](README.md): AniList entries carrying a
   `catalog` block should go **0 → ~19,000** (minus titles AniList lacks).
3. On the inspector page, a title now shows **two** candidate values for `genres`,
   `studios`, `mean`, `synopsis` — where before AniList had none.
4. Precedence changes become observable. Until step 3 shows two values, any
   precedence flip is provably a no-op.

## Non-goals

- Changing what the **meta sync** fetches. It works; leave it alone.
- Making AniList the catalog *authority* — that is the precedence work, gated on
  the per-field mechanism and the genre/studio hazards, not on this sweep.
