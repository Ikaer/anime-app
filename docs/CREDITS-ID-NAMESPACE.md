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
MAL page lists everything. If it ships, the page must say so.

**"Producteurs" IS the right label — keep it, and do not filter the bucket.**
Measured 2026-08-26 over the live cast slice (710 titles carrying studio credits,
3,257 `isMain: false` credits against 764 `isMain: true` — the bucket is 4.3x the
studio one, 4.59 per title against 1.08):

- The "animation co-producers" half of the old note is far smaller than it
  assumed. Only **60 of 430** producer studio **ids** are ever seen as
  `isMain: true` elsewhere in the slice, and they carry **6.5%** of the credits.
  This is not animation houses wearing a producer hat.
- It is a **production committee** roster, which is exactly what a producer is on
  the Japanese 製作 side. Shares below are of the whole bucket but come from a
  **hand classification of the top 60 names, covering 63.4% of credits** — the
  tail was sampled by eye, not classified, so read them as floors. Broadcasters
  15.9% (MBS, AT-X, TOKYO MX, BS11, TV Tokyo…), anime producers / committee leads
  12.8% (Aniplex, KADOKAWA, KLOCKWORX, ABC Animation), music labels 7.5%,
  publishers 6.5%, merch 5.5% (Movic, Good Smile, arma bianca), ad agencies 4.3%
  (Dentsu, JR Higashi Nihon Kikaku), film distributors 2.9%. The tail past rank 60 is more of the same plus game
  companies (Cygames, Yostar, Bushiroad), sound-recording vendors (DAX
  Production, Glovision, Rakuonsha) and pachinko makers (SANKYO, newgin).
- The genuinely wrong class is the **licence-buyers, and it is only 9.7%** — 20
  names, 316 credits (Crunchyroll 74, Funimation 71, Sentai 52, Aniplex of
  America 27, bilibili 16, Viz, Madman, Netflix, Selecta Visión, Tencent…).
- ⚠️ **Do NOT excise them with a name list.** The name cannot decide the case:
  Funimation is credited on *Akira* (1988) and *Dragon Ball Z* (1989), predating
  the company — pure licensing — while Crunchyroll's credits run to a **2024
  median** and bilibili's are **100% post-2019**, where a committee seat is the
  likely reading. A blanket name rule would be wrong on exactly the modern
  streaming co-productions. AniList files licensees under `studios` and offers no
  field separating the two, so the label stays and the bucket is not filtered.
  Same posture as the ⚠️ against widening the rejection profile. What a UI caveat
  on `/stats` would cost is one clause on `stats.castMissing`, the note that
  already covers this dimension — not built, and not a precondition.
- The MAL cross-check is a **false friend** and must not be quoted as evidence:
  106 producer names (20.6% of credits) appear in MAL's catalog-wide `studios`
  vocabulary, but MAL credits Shueisha, Movic, Fuji TV, Pony Canyon and Frontier
  Works as a studio on **exactly one title each** — data-entry noise, not an
  animation credit. The id-overlap figure above is the one to quote.

Scope caveat on every number here: the cast slice covers the owner's ~700
statused titles, never the ~25k catalog, so it is a taste-shaped sample.

One thing not to "harmonize" later: `/stats` buckets producers as `r:${p.id}`
while studios use `s:${catalogNameKey(s.name)}`. That looks like the namespace
bug DECISIONS.md fixed for studios and is not — producers are AniList-only, one
id namespace, and the probe measured **zero** credits without an id. The
measurement above is id-keyed for the same reason.

**Seiyuu stay external.** They link out to AniList because `/credits/staff/<id>`
scans *production* credits, which never contain voice actors. Source-qualifying
does not change that.

## Non-goals

- Canonical ids for studios/staff (option E) — deferred, not rejected.
- An internal seiyuu credits page.
- Any change to anime canonical ids, the registry, or catalog precedence. This is
  strictly about **secondary entity** identity.
