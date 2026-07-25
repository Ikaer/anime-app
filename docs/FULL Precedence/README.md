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

These numbers are *why* the naive "flip the array" fix was a dead end **before the
sweep shipped**. Kept as the historical baseline; the post-sweep numbers are below.

| Fact | Value |
|---|---|
| MAL catalog records | 25,382 |
| AniList meta entries | 19,297 |
| AniList entries carrying a **`catalog`** block | **0** |
| Registry entries with **no** MAL id | **0** |
| Distinct MAL genre names | 78 |
| AniList genre names (`GenreCollection`) | 19 |

**Consequence, then:** flipping `DEFAULT_CATALOG_PRECEDENCE` to `['anilist','mal']`
was a **literal no-op**. `catalogFromAnilist()` reads `entry.catalog`, which did
not exist on a single title, so it returned `{}` and MAL won every field by
fall-through. The precedence work was blocked on **data**, not on the merge.

## After the sweep (2026-07-25, E2 shipped)

The [catalog sweep](anilist-catalog-sync.md) ran on production and closed the data
gap. Precedence is no longer a no-op — every overlapping field now has a real
both-present population where it was zero.

| Fact | Value |
|---|---|
| AniList entries carrying a **`catalog`** block | **19,293** (was 0) |
| Titles present in **both** MAL + AniList catalog | 19,293 |

**Both-present coverage per overlapping field** (the population precedence order
actually decides):

| Field | Both present | MAL only | AniList only |
|---|---|---|---|
| `mean` | 15,649 | 1,051 | 95 |
| `genres` | 17,127 | 2,129 | 21 |
| `studios` | 14,430 | 961 | **1,900** |
| `synopsis` | 17,809 | 588 | 486 |
| `numEpisodes` | 18,771 | 522 | 0 |

`studios`' 1,900 AniList-only titles are a genuine coverage gain — and mean the
producer-contamination hazard ([studio-id-namespace.md](studio-id-namespace.md) §2)
is now **live in the store**, not hypothetical: the sweep used the `nodes` query
without the `isMain` filter. The genre and studio decisions are now measurable
against real both-present data.

> **These are pre-fix numbers.** Reproduce them any time with
> `node scripts/measure-precedence.js` — written so the Phase 0 before/after delta
> is computed identically rather than re-derived (gate 2 turns on that delta). It
> also reports two things this table doesn't: the studio id-namespace **mixing
> rate** (pre-fix **15.5%** — 2,997 titles that would fall through to MAL-namespace
> ids under an anilist-first flip), and the contamination itself as list bloat
> (AniList **2.68** studios/title vs MAL's **1.10**). Expect `studios` coverage to
> *drop* after the re-sweep: producer-only entries correctly become `undefined`.

## MAL-legacy inventory

The column that matters is **Scope**. `Eliminate` items are closed by this
folder's work. `Keep` items are deliberate and **must stop being re-flagged** —
each already has a rationale in `CLAUDE.md`.

### Eliminate — precedence work closes these

| # | Item | Where | Notes |
|---|---|---|---|
| E1 | Catalog precedence is a single global array; per-field is inexpressible | `mergeWithProvenance`, `DEFAULT_CATALOG_PRECEDENCE` | The structural blocker for everything the user actually wants |
| ~~E2~~ | ~~AniList `catalog` blocks unpopulated for MAL-linked titles~~ | `catalog/anilist.json` | ✅ **SHIPPED 2026-07-25** — catalog sweep, 0 → 19,293 → [anilist-catalog-sync.md](anilist-catalog-sync.md) |
| E3 | `genres` sourced from MAL | `catalogFromMal` | Target: AniList → [genre-vocabulary.md](genre-vocabulary.md). **Blocked on a product decision** (see Open decisions) |
| E4 | `studios` sourced from MAL | `catalogFromMal` | Target: AniList → [studio-id-namespace.md](studio-id-namespace.md). Contamination is **live**, see Phase 0 |
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
identity (K4–K6). Apply the rule; do not assume all 38 hits are violations.

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

It is coupled to Goal 2 — but **build it first and read-only** (see Phase 2): it is
the instrument that verifies every later flip, so it must exist before the flips,
and it is more useful standing on a hardcoded map than not existing while the
settings UI is built. Layout should favour dense raw-JSON legibility over the app's
usual card styling — this is a debugging surface.

## Implementation order

> Reconciled against the code on 2026-07-25. Two things moved since the first
> draft of this section: **E2 shipped**, and the studio de-contamination — which
> [studio-id-namespace.md](studio-id-namespace.md) called *"blocking, must precede
> the sweep"* and which did **not** precede it — is now repairing live data rather
> than preventing future damage, so it goes first. E9–E11 were missing from this
> section entirely despite being in the Definition of Done.

Order is load-bearing. Phases 0 and 1 have no dependency on each other and can run
in parallel; everything after Phase 1 wants the mechanism in place.

### Phase 0 — de-contaminate `studios` (first; unblocks the E4 measurement)

The sweep shipped with `studios { nodes { id name } }`, which discards the edge and
therefore `isMain`. Consequences that are **true right now**, not gated on a flip:
19,293 entries carry producer-contaminated studio lists, and the **1,900
AniList-only titles already surface producers as studios** through the existing
fall-through (MAL has no studios for them at all). That is a live defect in
`/stats`' studios dimension, the reco studio IDF profile and `/credits/studio/<id>`.

1. ✅ **`CATALOG_FIELDS` → `studios { edges { isMain node { id name } } }`**, mains
   only. Verified live against AniList (2026-07-25): HTTP 200 at `perPage: 50` —
   no complexity-ceiling problem — `isMain` never null, and the mains-only mean is
   **1.04 studios/title against MAL's 1.10**, i.e. the filtered list now means what
   `catalog.studios` claims. Producers measured **4.35/title**: that is the volume
   that had been landing in the field.
2. ✅ **Empty `genres`/`studios` store `undefined`, never `[]`.** Not cosmetic:
   `mergeWithProvenance` takes the first value that is `!== undefined`, so an empty
   array is a *winning* value. Invisible under MAL-first, but the moment Phase 3
   sets `studios: ['anilist','mal']` an empty AniList list would silently beat
   MAL's real one — the same hazard this phase exists to fix, arriving through a
   different door.
3. ✅ **`CATALOG_SCHEMA_VERSION` stamped into each block**, with the sweep
   re-queueing anything whose `v` doesn't match. A plain re-run was a no-op
   (`selectCatalogSweepTargets` skipped on `catalog !== undefined`, and all 19,293
   entries have a block); the backfill signal can say "never fetched" but not "the
   shape changed". Chosen over a force flag because it keeps the run **resumable**
   — a force flag restarts from zero on every interruption of a 15–20 min sweep —
   and because it needs no endpoint or button change at all: the existing
   Connections button and the cron step pick the work up unprompted.
4. ⏳ **Re-sweep, then measure** with `scripts/measure-precedence.js` (new; it
   reproduces this doc's pre-fix baseline exactly, so the delta is readable):
   AniList studio coverage after the fix, and how many titles keep **MAL-id**
   studios by fall-through. The second number is the input to gate 2 below.

**Producers are deliberately NOT captured here.** The original rationale was "free
only if it rides this pass, else a third 19k sweep" — void, since a sweep is a
background job that costs nothing on this project. What remains is the cost side:
`catalog/anilist.json` is parsed on **every cold row build**, and this repo's own
precedent (`AniListCastEntry`'s doc comment — the entire reason cast is off-join)
is *don't put display-only bulk in a joined slice*. Producers also already have a
home on the cast slice, so a second one invites a dedup question with no consumer
asking for it. Do it as its own task, with its consumer: model field +
`catalogFromAnilist` + the `/stats` read + coverage/dedup against the cast slice +
a re-sweep, together.

### Phase 1 — the per-field mechanism (E1) + pin `mean`

No data prerequisite; can run alongside Phase 0.

- `mergeWithProvenance` takes `(default, byField)` and resolves per key. Provenance
  recording is unchanged.
- `CATALOG_PRECEDENCE_BY_FIELD` lands next to `DEFAULT_CATALOG_PRECEDENCE` in
  `domain/animeUtils.ts`.
- **Pin `mean: ['mal','anilist']` explicitly.** It is its own Definition-of-done
  line ("rather than winning by default") and the one flip with no blocker.

### Phase 2 — inspector page (E6), *then* settings (E5)

Split these rather than building them as one unit. The inspector is the
verification instrument for every later flip: build it read-only against the
hardcoded map first, confirm the mechanism does what Phase 1 claims, then put the
`/settings` UI on top of a page that already proves it.

### Phase 3 — the two flips, each behind its own gate

- `studios: ['anilist','mal']` — unblocked by Phase 0's measurement (gate 2 below).
- `genres` — blocked on the product decision (gate 1 below).

### Phase 4 — id-space cleanup (E8, E11, E9+E10)

Orthogonal to precedence; slots anywhere after Phase 0. Ordered cheapest-first:

1. **E8** — flip `selectMetaTargets` to AniList-id-only, drop its MAL branch and
   the `MetaIdSpace` parameter, rename `fetchAnilistCatalogByMalIds` →
   `fetchAnilistCatalog`. Immediate payoff beyond tidiness: it kills the
   negative-caching loop where the 6,085 titles with no AniList id are re-queued on
   **every** meta-sync run (~122 requests that always miss and never converge).
2. **E11** — `mediaRecommendation { id idMal }`. AniList's own id is discarded
   today, which is the *only* reason the keyless hydration path needs a MAL bridge
   at all. Also a real coverage gain: recs AniList cannot map to a MAL id are
   currently dropped, and those are exactly the AniList-only titles a keyless
   install exists to surface.
3. **E9 + E10 as one atomic change** — `feed.ts`, `similar.ts`, `refresh.ts`,
   `byCredits.ts` plus the cache key format. Largest blast radius in the folder;
   do it last, and do it in one go (a half-converted engine mixes key spaces).

### Phase 5 — closeout

- **E7 audit** — sweep the ~38 raw `sources.*` reads with the classification rule.
- **`CLAUDE.md`** — record K4–K7 so they stop being re-flagged, **and delete the
  now-superseded "the reco engine stays MAL-keyed internally by design" stance**
  (PROVIDER-PARITY B3). The boundary rule at the top of this doc supersedes it, so
  until that paragraph goes, `CLAUDE.md` contradicts the direction Phase 4
  implements.

## Open decisions

Two gates. Neither blocks Phases 0–2 or 4; both block their own flip in Phase 3.

**1. `genres` — option A, C or D?** See
[genre-vocabulary.md](genre-vocabulary.md). D (split `genres` / `themes` /
`demographics`) is recommended there, and it is worth knowing that **D is the
single largest work item in this folder** — a hand-curated ~60-entry partition
table, two new filter dimensions at ~6 spots each per `CLAUDE.md`, and possibly new
reco sources. Larger than the precedence mechanism itself. A is explicitly *not*
the default: on this store it silently degrades both the genre filter (78 → 19
options) and the genre reco source.

**2. `studios` — does option E get un-deferred?**
[studio-id-namespace.md](studio-id-namespace.md) step 2: full AniList coverage ⇒
the flip is safe; materially partial ⇒ mixed id namespaces are the permanent steady
state and canonical studio ids (`../CREDITS-ID-NAMESPACE.md` option E) stop being
deferrable. The post-sweep table above already shows 961 MAL-only `studios` titles,
so mixed namespaces look permanent at *some* rate — Phase 0's re-measurement gives
the real number to rule on.

## Definition of done

MAL legacy is **closed** when all of these hold:

- [x] Every AniList entry for a MAL-linked title carries a `catalog` block (E2) — **shipped 2026-07-25, 19,293 blocks**
- [x] `CATALOG_FIELDS` uses the `edges { isMain node }` form, empty arrays store `undefined`, and the block is schema-versioned so stale entries re-queue (Phase 0, code) — **shipped 2026-07-25**
- [ ] The store is re-swept at `CATALOG_SCHEMA_VERSION` 2 and re-measured (Phase 0, data)
- [ ] Catalog precedence is per-field, with a global default (E1)
- [ ] The inspector page shows per-field winner + ordering + all raw values (E6)
- [ ] Precedence is user-configurable in `/settings` (E5)
- [ ] `mean` explicitly pinned to MAL rather than winning by default (target table)
- [ ] `genres` resolved and sourced per decision, with the 60-value loss handled (E3)
- [ ] `studios` resolved and sourced per decision, with both hazards handled (E4)
- [ ] AniList queried **only** by AniList ids; `Media(idMal:)` gone as a query key (E8)
- [ ] Provider ids converted to canonical **at ingest**; reco internals, the reco
      cache and `RECS_QUERY` all speak canonical (E9–E11)
- [ ] Raw-`sources.*` reads audited; every survivor justified under the rule (E7)
- [ ] The **Keep** table is reflected in `CLAUDE.md`, and the superseded B3 stance removed

When this list is checked, "is AniList the catalog north star yet?" has a written
answer and does not need re-investigating.

## Non-goals

- **Re-deriving join identity from scratch.** Canonical ids and the registry are
  settled; E9–E11 are about *converting at ingest*, not about a new identity scheme.
- **Canonical ids for studios/staff** — deferred in
  [../CREDITS-ID-NAMESPACE.md](../CREDITS-ID-NAMESPACE.md) (option E), still
  deferred *unless* Phase 0's measurement forces gate 2 open.
- **Personal precedence.** SIMKL > MAL > AniList is settled and deliberate; this
  folder is about **catalog** precedence.
- **`defaultTitleLanguage`.** Title sourcing is a separate policy question tracked
  in [../SETUP-AND-CONFIG.md](../SETUP-AND-CONFIG.md), not a data-quality one.
