# FULL Precedence — closing the MAL-legacy question for good

> ## ✅ CLOSED — 2026-07-25
>
> Every item E1–E11 is shipped and the Definition of Done is fully checked. The
> short answer to the question this folder exists to stop re-asking:
>
> **AniList is not "the catalog north star", and deliberately not.** Precedence is
> per-field and user-configurable; MAL keeps `mean` (voter base) and `studios`
> (measured coverage — the AniList case was producers miscounted as studios);
> `genres` is unioned rather than arbitrated; everything else follows the default,
> and `/settings` can repoint any of it. Separately, provider ids no longer travel:
> they are converted to canonical **at the boundary**, and each provider is queried
> with its own id.
>
> **Genres are fully resolved**: C (union) merged the vocabularies, then D (the
> three axes) split them apart as a derived lookup rather than three catalog
> fields — 78 values → 25 genre / 5 demographic / 48 theme, with the genre filter
> built alongside it because it turned out never to have existed.
>
> One thing remains, and it is a parameter rather than a design question:
> **deepen the AniList season crawl** (`BULK_CRAWL_YEARS_BACK = 8` vs MAL's
> 1960). Two documented survivors are listed under the Definition of Done.
>
> The rest of this document is the record of how each decision was reached. Read
> it before re-opening any of them.

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

> **⚠️ The `studios` row here is an ARTIFACT — superseded by the next section.**
> Those 1,900 "AniList-only" titles were read as a coverage gain. They were
> producers being counted as animation studios: the sweep used the `nodes` query
> with no `isMain` filter ([studio-id-namespace.md](studio-id-namespace.md) §2).
> The table is kept as the baseline the Phase 0 delta is measured against; every
> other row is sound.

## After the `isMain` re-sweep (2026-07-25, Phase 0 shipped)

Re-swept on production at `CATALOG_SCHEMA_VERSION` 2 — all 19,293 entries
re-queued off the version stamp, no force flag, no button change. **The
contamination is gone**, and it took the case for flipping `studios` with it.

| Metric | Pre-fix | Post-fix | MAL |
|---|---|---|---|
| Mean studios/title (AniList) | 2.68 | **1.09** | 1.11 |
| Titles where AniList's list is longer than MAL's | 60.0% | **2.2%** | — |

| Field | Both present | MAL only | AniList only |
|---|---|---|---|
| `mean` | 15,650 | 1,050 | 95 |
| `genres` | 17,128 | 2,128 | 21 |
| `studios` | **11,730** | **3,661** | **524** |
| `synopsis` | 17,807 | 588 | 489 |
| `numEpisodes` | 18,774 | 519 | 0 |

**Three findings, all of which point the same way.**

**1. AniList is the WEAKER studio source, not the stronger one.** Post-fix MAL has
studios for 15,391 titles against AniList's 12,254. The "AniList-only" column
collapsed 1,900 → 524 because most of those titles had no *animation* studio on
AniList at all, only producers. The coverage argument for `studios: ['anilist','mal']`
was an artifact of the bug.

**2. Under MAL-first, AniList's unique titles are ALREADY captured.** Those 524
fall through to AniList today. So flipping the field would change only the 11,730
titles where *both* sources have data — i.e. it gains **zero** coverage and swaps
MAL-namespace studio ids for AniList's on two-thirds of the catalog.

**3. Union (genre option C applied to studios) barely earns its keep.** Measured
over the 11,730 both-present titles:

| What unioning AniList in would add | Titles | |
|---|---|---|
| Nothing — same names | 10,306 | 87.9% |
| Only an **alias** of a MAL studio (`Gallop` / `Studio Gallop`) | 534 | 4.6% |
| A **genuinely new** studio | 890 | 7.6% (950 credits) |

Genres and studios are **not symmetric**, and this is why option C transfers badly:
genres union cleanly because they are already **name**-keyed (synthetic `id: 0`,
every consumer reads `name`), so dedupe is a `Set`; and the 60 MAL-only values are
genuinely distinct concepts. Studios have no cross-source dedupe key, and 4.6% of
the time the union would list one real studio twice.

**Consequence for gate 2.** The id-namespace mixing rate rose 15.5% → **31.7%**
(5,697 of 17,951 titles with studios would fall through to MAL ids under a flip) —
but that is now moot, because the flip has no reason to happen. What is NOT moot:
mixing is **already live at ~2%** (the 524 AniList-only-studio titles carry
AniList-namespace ids under today's fall-through), so `/stats` already
double-counts them and the reco IDF already fragments on them. See gate 2 below
for the cheap fix that closes this permanently.

> Reproduce all of this with `node scripts/measure-precedence.js` — written so the
> before/after delta is computed identically rather than re-derived.

## MAL-legacy inventory

The column that matters is **Scope**. `Eliminate` items are closed by this
folder's work. `Keep` items are deliberate and **must stop being re-flagged** —
each already has a rationale in `CLAUDE.md`.

### Eliminate — precedence work closes these

| # | Item | Where | Notes |
|---|---|---|---|
| ~~E1~~ | ~~Catalog precedence is a single global array~~ | `mergeWithProvenance`, `CATALOG_PRECEDENCE_BY_FIELD` | ✅ **SHIPPED 2026-07-25** — per-field map + `catalogPrecedenceFor()`; `mean` pinned to MAL |
| ~~E2~~ | ~~AniList `catalog` blocks unpopulated for MAL-linked titles~~ | `catalog/anilist.json` | ✅ **SHIPPED 2026-07-25** — catalog sweep, 0 → 19,293 → [anilist-catalog-sync.md](anilist-catalog-sync.md) |
| ~~E3~~ | ~~`genres` sourced from MAL~~ | `unionGenres` | ✅ **SHIPPED 2026-07-25 — option C, union.** Not a precedence question: genres merge element-wise, so nothing is lost and the 60-value problem is void → [genre-vocabulary.md](genre-vocabulary.md) |
| ~~E4~~ | ~~`studios` sourced from MAL~~ | `catalogFromMal` | ✅ **RESOLVED 2026-07-25 — not a defect.** MAL stays the source; the AniList case was producers miscounted as studios. Contamination fixed in Phase 0 → [studio-id-namespace.md](studio-id-namespace.md) |
| ~~E5~~ | ~~Precedence is a source-code constant, not user-configurable~~ | `/settings`, `getCatalogPrecedenceByField` | ✅ **SHIPPED 2026-07-25** — `settings.json` overrides layered over the shipped map; one seam feeds the merge, the row-cache key and the inspector |
| ~~E6~~ | ~~No way to *see* which provider won a field~~ | `/precedence`, `explainCatalogPrecedence` | ✅ **SHIPPED 2026-07-25** — per-field winner + ordering + every provider's value |
| ~~E7~~ | ~~Residual raw-`sources.*` value reads that bypass the merge~~ | 33 hits, classified | ✅ **DONE 2026-07-25** — two violations (both SIMKL-pinned badges), rest legitimate; rule recorded on `AnimeSources` |
| ~~E8~~ | ~~AniList is enriched **by MAL id** (`Media(idMal:)`)~~ | `selectMetaTargets`, `cast.ts` | ✅ **SHIPPED 2026-07-25** — AniList-id-only everywhere, `MetaIdSpace` gone; discovery moved to a cron season crawl |
| ~~E9~~ | ~~Reco engine keys its internal maps on `crosswalk.mal`~~ | `feed.ts`, `similar.ts`, `refresh.ts`, `byCredits.ts` | ✅ **SHIPPED 2026-07-25** — converted at ingest via `buildCrosswalkIndexes()` (resolve-only, never mints) |
| ~~E10~~ | ~~`cache/recommendations.json` stored MAL-id-keyed~~ | `reco/data.ts` | ✅ **SHIPPED 2026-07-25** — canonical, with `RECO_CACHE_VERSION`; a stale file is discarded, not migrated |
| ~~E11~~ | ~~`RECS_QUERY` seeds AniList by MAL id~~ | `anilist/sync.ts` | ✅ **SHIPPED 2026-07-25** — seeded by `id_in`, `mediaRecommendation { id idMal }`; AniList-only recs are now first-class candidates |

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
| ~~`studios`~~ | ~~AniList~~ → **MAL** | **Reversed by Phase 0's measurement.** The AniList coverage advantage was producers miscounted as studios; post-fix MAL covers 15,391 titles to AniList's 12,254, and AniList's 524 unique titles already fall through under MAL-first. A flip would gain nothing and swap id namespaces on two-thirds of the catalog. See gate 2 |
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
4. ✅ **Re-swept on production and re-measured.** All 19,293 entries re-queued off
   the version stamp. Contamination gone (2.68 → 1.09 studios/title against MAL's
   1.11). Full results in [After the `isMain`
   re-sweep](#after-the-ismain-re-sweep-2026-07-25-phase-0-shipped) — the headline
   is that the case for flipping `studios` to AniList **did not survive the fix**.

**Phase 0 is complete.** It also resolved gate 2 by dissolving it: see below.

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

### Phase 1 — the per-field mechanism (E1) + pin `mean` ✅ SHIPPED 2026-07-25

- ✅ `mergeWithProvenance` takes an optional `byField` map and resolves precedence
  **per key**. Provenance recording is unchanged — it already stored the winner
  per field, which is exactly what E5/E6 need. Passing no `byField` reproduces the
  old single-array behaviour, which is what the *personal* merge still does
  (SIMKL > MAL > AniList is one decision for the whole block, not a per-field one).
- ✅ `CATALOG_PRECEDENCE_BY_FIELD` + `catalogPrecedenceFor(field)` live next to
  `DEFAULT_CATALOG_PRECEDENCE` in `domain/animeUtils.ts`. The helper is the single
  seam the inspector page (E6) and the settings editor (E5) read, so they report
  what the merge did rather than re-deriving it.
- ✅ **`mean` pinned to MAL explicitly**, with the reason recorded at the
  definition: larger voter base, and it backs `minScore`/`maxScore`, so a mixed
  source would mean mixed filter semantics inside one sorted list.

**Verified by temporarily flipping the pin**, since pinning `mean` to the provider
that already won by fall-through proves nothing on its own: with
`mean: ['anilist','mal']` Death Note reported `mean 8.4 / provenance anilist`;
reverted, `mean 8.62 / provenance mal`. The override genuinely overrides.

Two fields are deliberately **absent** from the map, each for its own reason:
`genres` is not a precedence question at all (unioned element-wise — see E3), and
`studios` measured out as MAL-covers-more, so an override would gain nothing (E4).

### Phase 2 — inspector page (E6) ✅ SHIPPED, *then* settings (E5)

Split rather than built as one unit, and that ordering paid off: the inspector is
the verification instrument for every later flip, so it exists first, read-only
against the hardcoded map.

**`/precedence?id=<canonicalId>`** — one row per catalog field: winning provider,
the ordering in force, the effective value, and **every** provider's value beside
it. Backed by `explainCatalogPrecedence` in `domain/animeUtils.ts`, a pure reader
that rearranges what is already on the record — no bespoke API, no new data path.

Three decisions worth keeping:

- **`genres` reports `union`, never a winner.** `unionGenres` runs after the merge
  and overwrites its choice, so `provenance.catalog.genres` names whoever the
  merge happened to pick and means nothing. Rendering that as a winner would be
  the one lie this page could most easily tell — on the page whose entire job is
  to stop the merge being re-derived from scratch. The row shows each provider's
  list instead.
- **Contested fields sort first.** The interesting rows are where providers
  disagreed (13 of 25 on Death Note), not the dozen where only MAL had anything.
- **Not translated**, deliberately. The content is field identifiers, provider ids
  and raw JSON; the doc asks for "dense raw-JSON legibility over the app's usual
  card styling". Same standing exception as `/rate`'s rubric. Only the nav label
  is localized.

E5 now has somewhere to render into: `catalogPrecedenceFor()` is the seam both
read, so the settings editor and this page cannot disagree about what the merge
did.

### Phase 3 — the two flips ✅ RESOLVED WITHOUT FLIPPING

Neither flip happened, and both for good reasons rather than for lack of time:

- `studios` — **stays on MAL.** Phase 0's measurement dissolved the case (gate 2).
- `genres` — **unioned, not arbitrated** (E3, option C). It was never a precedence
  question (gate 1).

This phase is the folder's most useful outcome: the two fields the whole exercise
was named after both turned out not to need a precedence flip, and the mechanism
built for them (E1/E5) is what makes any *future* flip a settings change.

### Phase 4 — id-space cleanup ✅ SHIPPED 2026-07-25 (E8, E11, E9+E10)

Done in the planned cheapest-first order, one commit each except the last two:

1. ✅ **E8** — `selectMetaTargets` is AniList-id-only; `MetaIdSpace`, the
   `idMal_in` twin of `TAGS_QUERY` and `refreshAnilistMetaForIds`' `by` argument
   are gone. It killed the negative-caching loop (~122 requests a run that always
   missed) at zero coverage cost, since a title with no AniList id is exactly one
   AniList never returned. **Two things the plan did not anticipate**: `cast.ts`
   was also a live `Media(idMal:)` query key and had to go with it, or the
   Definition of Done would have read as met while it wasn't; and dropping the
   bridge makes *discovery* a job that has to actually run, hence the
   `anilistDiscovery` cron step.
2. ✅ **E11** — `mediaRecommendation { id idMal }`, seeded by `id_in`.
   `fetchAnilistCatalogByMalIds` → `fetchAnilistCatalog`, and
   `CATALOG_BY_MAL_QUERY` is gone.
3. ✅ **E9 + E10** — shipped **together with E11**, not after it. The doc's own
   "do it in one go, a half-converted engine mixes key spaces" applies to E11
   too: E11 *is* the ingest side of the same conversion, and splitting it out
   would have produced a commit whose only content was an intermediate key space.

### Phase 5 — closeout ✅ DONE 2026-07-25

- ✅ **E7 audit** — 33 reads classified; two violations fixed, and the rule itself
  recorded on `AnimeSources` so it does not have to be re-derived from this doc.
- ✅ **`CLAUDE.md`** — K4–K7 recorded, and the superseded "the reco engine stays
  MAL-keyed internally by design" stance (PROVIDER-PARITY B3) replaced by the
  boundary rule.

## Open decisions — BOTH CLOSED

> Both gates below are **answered**, and neither blocks anything. They are kept
> because the reasoning is what stops the questions being re-opened; read them as
> the record of a decision, not as pending work.

**1. `genres` — ANSWERED: C *and* D, both shipped 2026-07-25.** The framing below
asks "how do we avoid losing 60 values"; C answers by not losing any, and turned
out to *add* 11,087 genre assignments. D then split the three axes apart — as a
**derived function** (`domain/genreAxis.ts`), not the three catalog fields it was
scoped as, because the partition is a function of the genre name and names are
already the identity key. That removed the migration, the new catalog fields and
one of the two filter dimensions, turning "the single largest work item in this
folder" into an afternoon. See [genre-vocabulary.md](genre-vocabulary.md) for
what the original estimate got wrong.
The original analysis lives in [genre-vocabulary.md](genre-vocabulary.md); D's
cost is a hand-curated ~60-entry partition table, two new filter dimensions at ~6
spots each per `CLAUDE.md`, and possibly new reco sources — larger than the
precedence mechanism itself. Option A is off the table: on this store it silently
degrades both the genre filter (78 → 19 options) and the genre reco source.

**2. `studios` — ANSWERED by Phase 0's measurement, and ruled.**
The question was "full AniList coverage ⇒ flip is safe; materially partial ⇒
canonical studio ids (`../CREDITS-ID-NAMESPACE.md` option E) stop being
deferrable." The data answers it differently than either branch expected: **there
is no reason to flip `studios` at all.** MAL covers more titles (15,391 vs
12,254), AniList's 524 unique titles already fall through under MAL-first, and a
flip would gain zero coverage while swapping ids on two-thirds of the catalog.

So E4 resolves to **keep `studios` on MAL** — status quo, no work, and option E
stays deferred. `studios` simply comes off the "target per-field precedence" table
as a field that was targeted for the wrong reason.

**The one real fix it left — ✅ SHIPPED 2026-07-25.** The five reco/stats spots
that keyed studio identity on `s.id` now key on the **normalized name**
(`catalogNameKey`). Namespace mixing was never hypothetical: the 524
AniList-only-studio titles carry AniList-namespace ids *today*, so `/stats` was
double-counting them and the reco studio IDF was fragmenting on them. Measured
name agreement across sources is **87.9%** identical under normalization, which
is what made the name a usable key — it collapsed 86 split studios. No data
migration, no re-sweep, and the id-namespace question is closed rather than
deferred again.

## Definition of done

MAL legacy is **closed** when all of these hold:

- [x] Every AniList entry for a MAL-linked title carries a `catalog` block (E2) — **shipped 2026-07-25, 19,293 blocks**
- [x] `CATALOG_FIELDS` uses the `edges { isMain node }` form, empty arrays store `undefined`, and the block is schema-versioned so stale entries re-queue (Phase 0, code) — **shipped 2026-07-25**
- [x] The store is re-swept at `CATALOG_SCHEMA_VERSION` 2 and re-measured (Phase 0, data) — **done 2026-07-25**, contamination 2.68 → 1.09 studios/title
- [x] Catalog precedence is per-field, with a global default (E1) — **shipped 2026-07-25**
- [x] The inspector page shows per-field winner + ordering + all raw values (E6) — **shipped 2026-07-25**, `/precedence`
- [x] Precedence is user-configurable in `/settings` (E5) — **shipped 2026-07-25**
- [x] `mean` explicitly pinned to MAL rather than winning by default (target table) — **shipped 2026-07-25**
- [x] `genres` resolved (E3) — **option C, union across providers**, shipped 2026-07-25. No value is lost, so the 60-value question is void; `Thriller`→`Suspense` aliased
- [x] `studios` resolved (E4) — **stays on MAL**; the AniList case was a measurement artifact, hazard 2 fixed in Phase 0, hazard 1 moot without a flip
- [x] Studio identity keyed on normalized name, not `s.id`, in the five reco/stats spots — **shipped 2026-07-25**, collapsed 86 split studios
- [x] AniList queried **only** by AniList ids; `Media(idMal:)` gone as a query key (E8) — **shipped 2026-07-25**, with the one documented survivor below
- [x] Provider ids converted to canonical **at ingest**; reco internals, the reco
      cache and `RECS_QUERY` all speak canonical (E9–E11) — **shipped 2026-07-25**
- [x] Raw-`sources.*` reads audited; every survivor justified under the rule (E7) — **done 2026-07-25**
- [x] The **Keep** table is reflected in `CLAUDE.md`, and the superseded B3 stance removed — **done 2026-07-25**

**This list is complete.** "Is AniList the catalog north star yet?" now has a
written answer — *no, and deliberately not: per-field precedence decides it field
by field, MAL still wins `mean` and `studios` on measurement, `genres` is unioned
rather than arbitrated, and the user can repoint any of it in `/settings`* — and
does not need re-investigating.

### The two documented survivors

Both were examined under the rules above and kept, so neither is an open item:

- **`resolveAnilistMediaId` (`anilist/write.ts`) still does a live `Media(idMal:)`
  lookup.** That is crosswalk *resolution for a write*, not enrichment: refusing
  it would drop a user's rating rather than skip a metadata refill, and durable
  user data is the one cost category this project treats as real.
- **Two MAL id spaces remain inside the reco engine, legitimately.**
  `catalog.relatedAnime` targets are raw MAL relation ids (so `isPrematureSequel`
  and the franchise exclusions build a second MAL-keyed view on purpose), and
  `user/reco_dismissed.json` is frozen read-only MAL-keyed data whose ids
  `computeFeed` resolves through the crosswalk on read.

### What this exposed, and did not close

Dropping the MAL bridge (E8) makes AniList coverage a **crawl-depth** problem, as
[anilist-catalog-sync.md](anilist-catalog-sync.md#consequence-the-6085-become-a-crawl-depth-problem)
predicted. Two consequences, one handled and one open:

- **Handled**: new titles now gain an AniList id through `anilistDiscovery`, a
  bounded current-season crawl awaited in cron-sync before the enrichment sweeps.
  Without it, every title MAL's seasonal sync adds from here on would have been
  permanently invisible to AniList.
- **Open**: `BULK_CRAWL_YEARS_BACK = 8` against MAL's back-to-1960 window is why
  ~24% of the registry holds no AniList id. Deepening that crawl is the remaining
  coverage work, and it is a parameter, not a design question.

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
