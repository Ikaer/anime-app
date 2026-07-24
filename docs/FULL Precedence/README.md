# FULL Precedence — closing the MAL-legacy question for good

> **Why this folder exists.** The "catalog precedence still defaults MAL-first"
> question has been re-opened, re-investigated and re-deferred across multiple
> sessions. Every time, the same three facts get re-discovered from scratch. This
> folder writes them down once, draws a line between *what precedence should
> eliminate* and *what is deliberate MAL coupling that stays forever*, and gives a
> definition-of-done so the question can be **closed** rather than re-asked.

## The one distinction that ends the recurrence

Two different things have been conflated every time this comes up:

| Layer | What it decides | Keyed on | MAL's role |
|---|---|---|---|
| **Precedence** | Which *provider fills a field* (`catalog.mean`, `catalog.genres`, …) | field name | should have **no privileged status** |
| **Join identity** | Which *key groups records* for crowd-edge math, external API calls, outward links | `crosswalk.mal` | **legitimately MAL-keyed**, by design |

**"Precedence has no exceptions" and "the reco engine is MAL-keyed" are both true
at the same time.** They are not in conflict, because they operate on different
layers. Seeing `crosswalk.mal` in `feed.ts` is *not* evidence the precedence work
is unfinished — it is join identity, and it stays.

Internalise that sentence and the MAL-legacy inventory below stops looking like an
endless pile.

### …and the rule that governs join identity

Saying the reco engine is "legitimately MAL-keyed" is **not** a licence for MAL ids
to travel arbitrarily deep. The boundary rule:

> External data arriving keyed by a provider id (crowd edges as MAL ids, say) is
> converted to **canonical ids at the boundary**. Past that boundary everything
> speaks canonical, and each provider method takes **its own** id out of the
> crosswalk — AniList methods take AniList ids, MAL methods take MAL ids.
>
> **If the crosswalk holds no id for a provider, that provider simply does not
> enrich that title.** Accepting that is what keeps the schema simple: no
> gap-bridging paths, no foreign keys promoted to primary keys.

This **supersedes** the older "the reco engine stays MAL-keyed internally" stance
(`CLAUDE.md`, PROVIDER-PARITY B3). That stance was right that crowd edges *arrive*
as MAL ids; it was wrong to let them stay MAL-keyed all the way through. Converting
at ingest satisfies both. The affected items are reclassified below.

## End goal

1. **Precedence handled end to end, without exception.** Every catalog and personal
   field a consumer reads comes from the precedence merge. No surface reads a raw
   `record.sources.<provider>.<field>` to obtain a value that has a merged
   equivalent. (Reading `sources.*` for a genuinely provider-*specific* datum —
   "added to MAL on <date>" — is not an exception; see the classification rule below.)
2. **Per-field precedence, configurable.** Precedence becomes a per-field ordering
   with a global default, surfaced in `/settings` so the user sets who wins each
   field instead of it being a source-code constant.
3. **A precedence inspector page.** A page that shows, per title, each field's
   **winning value**, **winning provider**, **full ordering**, and **every
   provider's raw value** — laid out for raw JSON inspection rather than for
   browsing. This is the page that makes the whole system legible, and it is how
   you verify a precedence change did what you meant.

## Measured starting point (2026-07-24, live store)

These numbers are *why* the naive "flip the array" fix has always been a dead end.
Re-measure before implementing; do not re-derive.

| Fact | Value |
|---|---|
| MAL catalog records | 25,382 |
| AniList meta entries | 19,297 |
| AniList entries carrying a **`catalog`** block | **0** |
| Registry entries with **no** MAL id | **0** |
| Distinct MAL genre names | 78 |
| AniList genre names (`GenreCollection`) | 19 |

**Consequence:** flipping `DEFAULT_CATALOG_PRECEDENCE` to `['anilist','mal']`
today is a **literal no-op**. `catalogFromAnilist()` reads `entry.catalog`, which
does not exist on a single title, so it returns `{}` and MAL wins every field by
fall-through — under either ordering. The precedence work is blocked on **data**,
not on the merge.

## MAL-legacy inventory

The column that matters is **Scope**. `Eliminate` items are closed by this
folder's work. `Keep` items are deliberate and **must stop being re-flagged** —
each already has a rationale in `CLAUDE.md`.

### Eliminate — precedence work closes these

| # | Item | Where | Notes |
|---|---|---|---|
| E1 | Catalog precedence is a single global array; per-field is inexpressible | `mergeWithProvenance`, `DEFAULT_CATALOG_PRECEDENCE` | The structural blocker for everything the user actually wants |
| E2 | AniList `catalog` blocks unpopulated for MAL-linked titles | `catalog/anilist.json` | → [anilist-catalog-sync.md](anilist-catalog-sync.md) |
| E3 | `genres` sourced from MAL | `catalogFromMal` | Target: AniList → [genre-vocabulary.md](genre-vocabulary.md) |
| E4 | `studios` sourced from MAL | `catalogFromMal` | Target: AniList → [studio-id-namespace.md](studio-id-namespace.md) |
| E5 | Precedence is a source-code constant, not user-configurable | `animeUtils.ts` | Goal 2 |
| E6 | No way to *see* which provider won a field | — | Goal 3 |
| E7 | Residual raw-`sources.*` value reads that bypass the merge | ~38 grep hits, **not yet fully classified** | Audit during implementation; rule below |
| E8 | AniList is enriched **by MAL id** (`Media(idMal:)`) | `selectMetaTargets`, `fetchAnilistCatalogByMalIds` | Foreign key used as primary. Remove the id-space entirely → [anilist-catalog-sync.md](anilist-catalog-sync.md#id-space-policy--query-anilist-by-anilists-id) |
| E9 | Reco engine keys its internal maps on `crosswalk.mal` | `feed.ts`, `similar.ts`, `refresh.ts`, `byCredits.ts` | **Was K1.** Convert MAL-keyed crowd edges to canonical ids **at ingest**, then key on canonical |
| E10 | `cache/recommendations.json` stored MAL-id-keyed | `reco/data.ts` | **Was K2.** Follows E9 — once ingest converts, the cache stores canonical ids |
| E11 | `RECS_QUERY` seeds AniList by MAL id | `anilist/sync.ts` | **Was K3.** Same fix as E8: seed by AniList ids, resolve returned edges via the crosswalk |

### Keep — deliberate, not precedence exceptions

> **K1–K3 were here and have been reclassified to E9–E11.** The boundary rule
> above supersedes them: crowd edges arriving as MAL ids is a fact about *ingest*,
> not a licence to key the engine on MAL ids throughout. Do not restore them.

| # | Item | Where | Why it stays |
|---|---|---|---|
| K4 | `/rate?id=` is MAL-id-keyed | `pages/rate.tsx` | Documented as genuinely MAL-keyed by design |
| K5 | `getMalIdForCanonical` consults the MAL catalog slice | `store/slices.ts` | Crosswalk read; registry must stay below slices |
| K6 | Legacy MAL-numeric-id URL redirects | `resolveByMalId()` | Bookmark compatibility, permanent |
| K7 | MAL-specific metadata on the detail page ("added to MAL") | `anime/[id].tsx` | Provider-specific datum with no neutral equivalent |

**Classification rule for E7.** A `record.sources.<p>.<field>` read is a
**violation** if a precedence-merged equivalent exists (`catalog.*` / `personal.*`)
— it silently pins that surface to one provider. It is **legitimate** if the datum
is provider-specific by nature (K7), or if it is per-source *outcome* reporting
(`MoreLikeThis`'s `sources.mal.ok` is a fetch result, not a record field), or join
identity (K1). Apply the rule; do not assume all 38 hits are violations.

## Target per-field precedence

The user's decisions, and the reason each is not arbitrary:

| Field | Winner | Rationale |
|---|---|---|
| `genres` | **AniList** | Cleaner taxonomy — but drops 60 MAL values; unresolved, see [genre-vocabulary.md](genre-vocabulary.md) |
| `studios` | **AniList** | Aligns with AniList-as-catalog-authority — but two hazards, see [studio-id-namespace.md](studio-id-namespace.md) |
| `mean` | **MAL** | Larger voter base ⇒ more reliable central tendency. Also drives `minScore`/`maxScore`, so a mixed source would mean mixed filter semantics in one sorted list |
| everything else | **MAL** (unchanged default) | Flip individually once measurable; `synopsis` and cover art are the plausible AniList wins |

Shape sketch — a per-field override map over a global default, so the common case
stays a one-liner:

```ts
const CATALOG_PRECEDENCE_DEFAULT: CatalogSource[] = ['mal', 'anilist', 'simkl'];
const CATALOG_PRECEDENCE_BY_FIELD: Partial<Record<keyof AnimeCatalog, CatalogSource[]>> = {
  genres:  ['anilist', 'mal'],
  studios: ['anilist', 'mal'],
  mean:    ['mal', 'anilist'],
};
```

`mergeWithProvenance` takes the pair and resolves per key. Provenance recording is
unchanged — it already stores the winner per field, which is exactly what the
inspector page and the settings preview need.

## The inspector page

A reader, not a new data path. Everything it shows already exists on the record:

- **winning value + winning provider** ← `record.provenance.catalog[field]`
- **every provider's raw value** ← `record.sources.*` (the one place raw reads are
  the *point*)
- **full ordering per field** ← the resolved precedence config

It is coupled to Goal 2: the page **visualises the configuration**, so build them
together. Layout should favour dense raw-JSON legibility over the app's usual card
styling — this is a debugging surface.

## Implementation order

Order is load-bearing; two of these are no-ops if run early.

1. **[anilist-catalog-sync.md](anilist-catalog-sync.md)** — backfill AniList
   `catalog` blocks catalog-wide. *Nothing else is observable until this lands.*
2. **Per-field precedence** (E1/E5) + **inspector page** (E6) — the mechanism and
   the way to see it working, against data that now exists.
3. **[genre-vocabulary.md](genre-vocabulary.md)** and
   **[studio-id-namespace.md](studio-id-namespace.md)** — resolve each hazard,
   *then* flip that field. Do not flip before resolving.
4. **E7 audit** — sweep the raw-`sources.*` reads with the classification rule.

## Definition of done

MAL legacy is **closed** when all of these hold:

- [ ] Every AniList entry for a MAL-linked title carries a `catalog` block (E2)
- [ ] Catalog precedence is per-field, with a global default (E1)
- [ ] Precedence is user-configurable in `/settings` (E5)
- [ ] The inspector page shows per-field winner + ordering + all raw values (E6)
- [ ] `genres` resolved and sourced per decision, with the 60-value loss handled (E3)
- [ ] `studios` resolved and sourced per decision, with both hazards handled (E4)
- [ ] `mean` explicitly pinned to MAL rather than winning by default (target table)
- [ ] Raw-`sources.*` reads audited; every survivor justified under the rule (E7)
- [ ] AniList queried **only** by AniList ids; `Media(idMal:)` gone as a query key (E8)
- [ ] Provider ids converted to canonical **at ingest**; reco internals, the reco
      cache and `RECS_QUERY` all speak canonical (E9–E11)
- [ ] The **Keep** table is reflected in `CLAUDE.md` so K1–K7 stop being re-flagged

When this list is checked, "is AniList the catalog north star yet?" has a written
answer and does not need re-investigating.

## Non-goals

- **Re-deriving join identity from scratch.** Canonical ids and the registry are
  settled; E9–E11 are about *converting at ingest*, not about a new identity scheme.
- **Canonical ids for studios/staff** — deferred in
  [../CREDITS-ID-NAMESPACE.md](../CREDITS-ID-NAMESPACE.md) (option E), still deferred.
- **Personal precedence.** SIMKL > MAL > AniList is settled and deliberate; this
  folder is about **catalog** precedence.
- **`defaultTitleLanguage`.** Title sourcing is a separate policy question tracked
  in [../SETUP-AND-CONFIG.md](../SETUP-AND-CONFIG.md), not a data-quality one.
