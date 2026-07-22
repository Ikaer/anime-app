# Credits id namespace — studios, staff, and the provider-id problem

> **Open question. Nothing decided, nothing implemented.** This captures the
> problem and the cases that have to be answered before a line of code moves.

## The problem

Anime have a synthetic canonical id (`a_<n>`, minted by the registry). **Nothing
else does.** Studios, staff, characters and seiyuu are stored with their raw
provider id, and `/credits/studio/<id>` takes that raw id with no indication of
whose namespace it belongs to.

Today that is unambiguous **by accident** — every studio in the store came from
MAL. It stops being unambiguous the moment AniList contributes
`catalog.studios`, at which point MAL studio 4 and AniList studio 4 are two
different companies competing for the same URL.

## Current state

`catalog.studios` is **100% MAL-namespace**: `AniListMetaEntry.catalog` is
written only by the AniList **catalog crawl**, which has never run on the real
store — only the per-title enrichment sync (tags / staff / banner / relations).
The collision is **latent, not active**.

Worth stating because the intuition runs the other way: "most of our data comes
from AniList now" is true of the *enrichment* layer (tags, staff, cast,
producers, relations) and false of the *catalog spine* (titles, studios, genres,
scores), which is entirely MAL.

Where the two overlap they mostly agree (~92% identical studio names on a
sample); the disagreements are AniList reporting no main studio, or a naming
variant (`khara` vs `Studio khara`).

## The trigger

**The decision point is the catalog crawl, not the credits route** — the route is
just where the breakage becomes visible. The day any path writes
`AniListMetaEntry.catalog.studios` on this store, `catalog.studios` becomes
mixed-namespace. The model already carries a comment saying so; nothing enforces
it.

## What breaks, beyond the route

Studio id is a silent join key in several scoring systems, all of which degrade
without erroring: the reco `studio` taste source and the MMR diversity signature
(`reco/feed.ts`, `reco/scoring.ts`), "Dans le même studio / staff"
(`reco/byCredits.ts`), the global search credit index (`domain/globalSearch.ts`),
the credits page lookup (`domain/creditsCatalog.ts`), and `/stats`
(`domain/stats.ts`).

**Fragmentation mode:** one real studio splits into two id buckets, halving its
document frequency. Because these are **IDF-weighted, a split studio looks
*rarer* than it is and its weight goes UP** — the failure is a confidently wrong
recommendation, not a missing one. That is the worst shape of failure, and the
main reason to solve this before the crawl rather than after.

## Options

**A. Status quo — raw MAL ids, unqualified.** Zero work. Correct exactly as long
as catalog precedence stays MAL-first *and* the AniList catalog crawl never runs.
Fails silently the moment either changes.

**B. Re-key studios to AniList ids.** Measured dead: zero coverage gain, ~8%
regression, plus a migration. Revisit only after a crawl has populated
`.catalog`.

**C. Key credits by name.** Namespace-free by construction — the problem
evaporates rather than being managed, and MAL "Bones" and AniList "Bones" collapse
into one page. But identity by string: `khara` vs `Studio khara`, `A-1 Pictures`
vs `A1 Pictures` stay split without a normalization pass that will be wrong in
both directions — and **over-merging is worse than under-merging here**. Also does
not rescue producers, and the IDF consumers would have to move to name-keys too or
the route and the scoring disagree about what a studio is.

**D. Source-qualify the id in the route.** `/credits/studio/mal/4` vs
`/credits/studio/anilist/4`. The id becomes self-describing, so the collision
cannot occur by construction. **The provenance needed to emit the right link is
already in the model** (`record.provenance.catalog.studios`), at array-level
granularity — which is correct, since hydration takes `studios` wholesale from one
winning provider and never merges element-wise. Extends to a fifth provider as a
new segment rather than a migration, and unlocks internal producer pages. But it
splits one real studio into two pages where both namespaces have it, and means two
lookup paths per credit type forever.

**E. Mint canonical ids for studios/staff, like anime.** The "correct" answer by
symmetry: a studios registry, resolve-before-mint on a name + provider-id
crosswalk, `s_<n>` outward. **Deferred, not rejected** — a second identity spine
with its own reconciliation rules and a migration of six consumers, for a problem
that currently affects zero rows. Revisit if credits become a first-class surface
rather than a navigation aid.

## Cases to answer

**Route shape.** `/credits/studio/mal/<id>` over `/mal/credits/studio/<id>` — the
source qualifies the **id**, not the page, and a root-level `/mal/*` claims a lot
of top-level URL space for a qualifier.

**Is the qualifier redundant for staff?** `listAnimeByStaff` scans
`sources.anilist.staff`; staff is AniList-only and has no other possible source.
Either accept a redundant segment for shape consistency, or qualify only the
genuinely multi-source types (today: studios alone) and accept that the route
shape differs per type.

**The duplicate-page problem — the central trade.** Once AniList contributes
catalog studios, Bones plausibly has both ids, and two pages each list a *partial*
filmography with no cross-link and no knowledge of each other. Is a merge layer
wanted (that is option E creeping in)? If not, should each page at least link
"also known in AniList as …"? And do the IDF consumers follow the route's identity
rule, or keep their own — route and scoring disagreeing is defensible, but must be
deliberate.

**Producers have no internal home at all**, and are the strongest argument for
source-qualifying. They exist **only** on `AniListCastEntry.studios` with
`isMain: false`, and that slice is deliberately outside the hot-path join, so a
producer page needs a catalog-wide scan of a path kept cold on purpose (`/stats`
already does this, consciously). Worse, **coverage is asymmetric**: the cast slice
is lazily filled over the statused list and never the ~25k catalog, so an
AniList-keyed studio page would list a handful of titles where the MAL page lists
everything — same route, same chrome, wildly different completeness. If it ships,
the page must say so. Also: is "Producteurs" even the right label? AniList's
`isMain: false` bucket mixes animation co-producers with distributors and
licensors.

**Seiyuu stay external.** They link out to AniList because `/credits/staff/<id>`
scans *production* credits, which never contain voice actors. Source-qualifying
does not change that; an internal seiyuu page would need its own lookup over the
cast slice and inherit the coverage asymmetry above.

**Legacy URLs** must redirect, not 404 — to `…/studio/mal/<id>` and
`…/staff/anilist/<id>`, correct for 100% of existing rows. Same pattern as the
legacy MAL-numeric anime URLs `resolveByMalId()` already redirects.

**Every call site that emits a credit link** must learn to pass the source: the
detail page's studio chips and staff rows, `/stats`' `linkFor`, and the global
search dropdown. None has to reach for it — each already holds the record.
`globalSearch.ts` additionally builds a credit index **keyed by id**, so it must
either qualify its hits or merge by name.

**`/stats` aggregation buckets** count distinct anime per studio id, so mixed
namespaces split a studio into two rows — visible, unlike the silent IDF
fragmentation, but still wrong. Whatever unification rule lands has to apply here
too.

**Ordering relative to the catalog crawl.** *Fix first* means nothing ever
fragments, but the fix ships against a dataset where it is unobservable and cannot
be validated end to end. *Crawl first* means the fix is testable against real
mixed data, at the cost of a window where recommendations are quietly skewed.

## Non-goals

- Canonical ids for studios/staff (option E) — deferred, not rejected.
- An internal seiyuu credits page.
- Any change to anime canonical ids, the registry, or catalog precedence. This is
  strictly about **secondary entity** identity.
