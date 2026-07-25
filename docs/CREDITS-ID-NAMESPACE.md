# Credits id namespace — the routing half

> **Open.** The *scoring* half of this question is closed: the reco and `/stats`
> consumers key studio identity on the normalized name, not the provider id (see
> [DECISIONS.md](DECISIONS.md)). What is still unanswered is the **route**.

## The problem

Anime have a synthetic canonical id. **Nothing else does.** Studios, staff,
characters and seiyuu are stored with their raw provider id, and
`/credits/studio/<id>` takes that raw id with no indication of whose namespace it
belongs to — so MAL studio 4 and AniList studio 4 compete for the same URL.

**This is live, not latent.** The AniList catalog sweep has run: ~21k entries
carry a `catalog` block, and the ~524 titles where only AniList has a studio
already carry AniList-namespace ids through MAL-first fall-through.

Two id-keyed surfaces remain, and they are the whole of what is left:

- `/credits/studio/[id]` — the route itself, plus its two link sites
  (`GlobalSearch.tsx`, `stats.tsx`).
- `domain/globalSearch.ts` — builds a credit index **keyed by id**, so it must
  either qualify its hits or merge by name like the scoring consumers now do.

## Options still on the table

**A. Status quo.** Zero work. Wrong for ~2% of titles, silently.

**C. Key credits by name** — what the scoring consumers already do, extended to
the route. Namespace-free by construction, and MAL "Bones" and AniList "Bones"
collapse into one page. But identity by string: `khara` vs `Studio khara` stay
split without a normalization pass that will be wrong in both directions, and
**over-merging is worse than under-merging here**. Consistency with the scoring
side is the strongest argument for it.

**D. Source-qualify the id in the route.** `/credits/studio/mal/4` vs
`/credits/studio/anilist/4`. The collision cannot occur by construction, and the
provenance needed to emit the right link is already on the record
(`record.provenance.catalog.studios`, array-level — correct, since hydration takes
`studios` wholesale from one winning provider). Extends to a fifth provider as a
new segment. But it splits one real studio into two pages where both namespaces
have it, and means two lookup paths per credit type forever — **and it now
disagrees with the scoring side**, which is name-keyed.

**E. Mint canonical ids for studios/staff.** Deferred with a reason — see
DECISIONS.md.

## Cases to answer

**Does the route follow scoring?** Scoring went name-keyed. Route and scoring
disagreeing about what a studio *is* is defensible, but it has to be deliberate,
and it is the first thing to rule on — it collapses the option list.

**Is the qualifier redundant for staff?** `listAnimeByStaff` scans
`sources.anilist.staff`; staff is AniList-only and has no other possible source.
Either accept a redundant segment for shape consistency, or qualify only the
genuinely multi-source types (today: studios alone).

**Route shape, if D wins.** `/credits/studio/mal/<id>` over
`/mal/credits/studio/<id>` — the source qualifies the **id**, not the page, and a
root-level `/mal/*` claims a lot of top-level URL space for a qualifier.

**Legacy URLs must redirect, not 404** — to `…/studio/mal/<id>` and
`…/staff/anilist/<id>`, correct for 100% of existing rows. Same pattern as
`resolveByMalId()`.

**Producers have no internal home at all**, and are the strongest argument for
source-qualifying. They exist only on `AniListCastEntry.studios` with
`isMain: false`, on a slice deliberately outside the hot-path join — so a producer
page needs a catalog-wide scan of a path kept cold on purpose. Worse, coverage is
asymmetric: the cast slice is lazily filled over the statused list and never the
~25k catalog, so an AniList-keyed page would list a handful of titles where the
MAL page lists everything. If it ships, the page must say so. Also: is
"Producteurs" even the right label? AniList's `isMain: false` bucket mixes
animation co-producers with distributors and licensors.

**Seiyuu stay external.** They link out to AniList because `/credits/staff/<id>`
scans *production* credits, which never contain voice actors. Source-qualifying
does not change that.

## Non-goals

- Canonical ids for studios/staff (option E) — deferred, not rejected.
- An internal seiyuu credits page.
- Any change to anime canonical ids, the registry, or catalog precedence. This is
  strictly about **secondary entity** identity.
