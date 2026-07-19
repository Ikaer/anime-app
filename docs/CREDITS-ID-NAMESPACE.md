# Credits id namespace — studios, staff, and the provider-id problem

**Status: open question, nothing decided, nothing implemented.** This document
exists to capture the problem and every case that has to be answered before a
line of code moves. Written 2026-07-19, off the back of the `/stats` page adding
the first internal links to studio/staff credits.

---

## 1. The problem in one paragraph

Anime have a synthetic canonical id (`a_<n>`, minted by the registry). **Nothing
else does.** Studios, staff, characters and seiyuu are stored with their raw
provider id, and the credits route `/credits/studio/<id>` takes that raw id with
no indication of whose namespace it belongs to. Today that is unambiguous by
accident — every studio in the store came from MAL. It stops being unambiguous
the moment AniList starts contributing `catalog.studios`, at which point MAL
studio 4 and AniList studio 4 are two different companies competing for the same
URL, and several scoring systems that key on studio id silently fragment.

## 2. Current state, measured

Measured against the real store (`E:/Workspace/local/AnimeTracker/data`), 2026-07-19:

| | count |
|---|---|
| canonical ids | 25,370 |
| MAL records with `studios` | 17,418 |
| AniList meta entries | 15,019 |
| — with `tags` | 12,795 |
| — with `staff` | 13,041 |
| — **with a `.catalog` block** | **0** |
| titles with no studios from any source | 7,952 |

The decisive row is the bolded one. `AniListMetaEntry.catalog` is written only by
the AniList **catalog crawl**, which has never been run on this dataset — only
the per-MAL-id enrichment sync (tags / staff / banner / relations). So:

- `catalog.studios` is **100% MAL-namespace today**. The collision is latent, not active.
- The intuition "most of our data comes from AniList now" is true of the
  *enrichment* layer (tags, staff, cast, producers, relations) and false of the
  *catalog spine* (titles, studios, genres, scores), which is entirely MAL.

Agreement sample, over the 212 titles the cast sweep had reached at time of writing:

```
MAL has studios     : 212 | names identical to AniList's main studio: 194  (~92%)
MAL missing studios : 0   | AniList could fill: 0
disagreements: AniList reports no main studio (Studio Pierrot, Toei Animation),
               or a naming variant (`khara` vs `Studio khara`, ×4)
```

So re-keying studios to AniList *today* would gain zero coverage and lose ~8% to
name/absence mismatch. That option is measured-dead, not merely unattractive.

## 3. The trigger

The day `performAnilistBulkCatalogCrawl` (or any path writing
`AniListMetaEntry.catalog.studios`) runs on this store, `catalog.studios` becomes
mixed-namespace: MAL ids for MAL-linked titles, AniList ids for AniList-only ones.
This is already flagged in the model, at `AniListMetaEntry.catalog.studios`:

> *"would fragment studio affinity. Not a problem today (MAL wins for MAL-linked
> titles; AniList-only titles have no MAL studio profile anyway)."*

Nothing enforces that comment. **The decision point is the catalog crawl, not the
credits route** — the route is just where the breakage becomes visible.

## 4. What breaks, beyond the route

The credits page is the *visible* consumer. Studio id is also a silent join key in
three scoring systems, all of which degrade without erroring:

| Consumer | File | Keys on |
|---|---|---|
| Reco `studio` taste source (IDF profile) | `recommendations.ts` `FIELD_EXTRACTORS.studio` | `s.id` |
| MMR diversity signature | `recommendations.ts` (`s:${st.id}`) | `s.id` |
| "Dans le même studio / staff" | `similarByCredits.ts` `studioIdf` | `s.id` |
| Global search credit index | `globalSearch.ts` | `s.id` + name |
| Credits page lookup | `creditsCatalog.ts` `listAnimeByStudio` | `s.id` |
| `/stats` studio rows + links | `stats.ts`, `stats.tsx` | `s.id` |

Fragmentation mode: one real studio splits into two id buckets, halving its
document frequency. Because these are **IDF-weighted**, a split studio looks
*rarer* than it is and its weight goes **up** — the failure is a confidently
wrong recommendation, not a missing one. That is the worst shape of failure and
the main reason this is worth solving before the crawl rather than after.

## 5. Options

### A. Status quo — keep raw MAL ids, unqualified

Zero work. Correct exactly as long as catalog precedence stays MAL-first *and*
the AniList catalog crawl never runs. Both are true today. Fails silently the
moment either changes, which is the objection.

### B. Re-key studios to AniList ids

Measured-dead (§2): zero coverage gain, ~8% regression, plus a migration.
Revisit only after an AniList catalog crawl has actually populated `.catalog`.

### C. Key credits by **name** instead of id

Namespace-free by construction — one page per studio regardless of source, and
the mixed-namespace problem evaporates rather than being managed.

- **Pro:** collapses MAL "Bones" and AniList "Bones" into one page automatically.
  Also the only option where a producer and a studio of the same name unify.
- **Con:** identity by string. `khara` vs `Studio khara` (measured, ×4) stay
  split; `A-1 Pictures` vs `A1 Pictures` likewise. Needs a normalization pass
  (casefold, strip `Studio`/`Inc.`/punctuation) that will be wrong sometimes in
  both directions — over-merging is worse than under-merging here.
- **Con:** does **not** rescue producers (§6.4) — distributors like Funimation
  aren't in MAL's studio list under any name, so a name-keyed page for them is
  still empty unless the lookup also indexes the cast slice.
- **Con:** the three IDF consumers would need to move to name-keys too, or the
  route and the scoring disagree about what a studio is.

### D. Source-qualify the id in the route

`/credits/studio/mal/4` and `/credits/studio/anilist/4` are different pages. The
id becomes self-describing, so the collision cannot occur by construction.

The provenance needed to emit the right link is **already in the model**:

```ts
export type CatalogProvenance = Partial<Record<keyof AnimeCatalog, ProvenanceSource>>;
// record.provenance.catalog.studios → 'mal' | 'anilist' | 'simkl' | 'local'
```

Granularity is array-level, not element-level — which is correct, because the
hydration engine takes `studios` wholesale from one winning provider and never
merges element-wise. Every link producer already holds the record.

- **Pro:** honest, and extends to a fifth provider as a new segment rather than a migration.
- **Pro:** unlocks internal producer pages (§6.4) — the real prize.
- **Con:** splits one real-world studio into two pages when both namespaces have
  it (§6.3). This is the mirror image of C's weakness and the core trade.
- **Con:** two lookup paths per credit type, forever.

### E. Mint canonical ids for studios/staff, like anime

The "correct" answer by symmetry with the anime registry: a
`studios_registry.json`, resolve-before-mint on a name+provider-id crosswalk,
`s_<n>` outward. Deferred, not rejected — it is a large build (a second identity
spine, its own reconciliation rules, a migration of six consumers) for a problem
that currently affects zero rows. Worth revisiting if credits become a
first-class surface rather than a navigation aid.

## 6. Cases to think about

### 6.1 Route shape

`/credits/studio/mal/<id>` vs `/mal/credits/studio/<id>`. Preference for the
former: the source qualifies the **id**, not the page — `/credits` is one concept
whichever namespace the id belongs to. A root-level `/mal/*` segment also claims
a lot of top-level URL space for what is a qualifier. File would move from
`credits/[type]/[id].tsx` to `credits/[type]/[source]/[id].tsx`.

### 6.2 Is the qualifier redundant for staff?

`listAnimeByStaff` scans `sources.anilist.staff` — staff is AniList-only and has
no other possible source. `/credits/staff/anilist/456` is therefore always
`anilist`. Uniformity vs noise: either accept the redundant segment for shape
consistency, or qualify only the types that can actually be multi-source (today:
studios alone). Qualifying only studios means the route shape differs per type,
which is its own kind of surprise.

### 6.3 The duplicate-page problem — the central trade

Source-qualifying makes ids unambiguous but **splits one real studio into two
pages**. Once AniList contributes catalog studios, Bones plausibly has both a MAL
id and an AniList id; `/credits/studio/mal/4` and `/credits/studio/anilist/43`
would each list a *partial* filmography with no cross-link, and neither page
knows the other exists.

Sub-questions:
- Is a merge layer wanted (a hand-maintained or name-derived alias map that makes
  one canonical page and redirects the other)? That is option E creeping in.
- If not merged, should each page at least link "also known in AniList as …"?
- Does the same split apply to the three IDF consumers, or do they keep a
  separate (e.g. name-based) unification? Route and scoring disagreeing about
  studio identity is defensible but must be deliberate.

### 6.4 Producers have no internal home at all

Producers exist **only** on `AniListCastEntry.studios` with `isMain: false`, from
the single-title cast query. They are the strongest argument for source-qualifying,
and they carry their own problems:

- The cast slice is **deliberately outside** the six-slice join in
  `getAnimeForDisplay()` (bulk; display-only; would tax every row build). A
  producer credits page needs a catalog-wide scan of that slice. Precedent exists
  — `/stats` already calls `getAllAnilistCast()` per request — but it is a
  conscious re-entry onto a path kept cold on purpose.
- **Coverage asymmetry.** The slice is lazily filled: 212 of ~665 statused titles
  at time of writing, and never the ~25k catalog by design. So
  `/credits/studio/anilist/<id>` for Bones lists a handful of titles where the MAL
  page lists everything — same route, same chrome, wildly different completeness.
  If this ships, those pages must say so on the page, not just in this doc.
- Is "Producteurs" even the right label? AniList's `isMain: false` bucket mixes
  animation co-producers with distributors and licensors (Funimation, Aniplex),
  which is arguably a different concept than the UI implies.

### 6.5 Seiyuu stay external — confirm that holds

Seiyuu currently link out to `anilist.co/staff/<id>` because
`/credits/staff/<id>` scans *production* credits, which never contain voice
actors. Source-qualifying does not change this. A future internal seiyuu page
would need its own lookup over the cast slice, inheriting §6.4's coverage
asymmetry. Worth deciding whether that is on the roadmap before designing the
route, since `/credits/seiyuu/anilist/<id>` would be a third type.

### 6.6 Legacy URLs

`/credits/studio/123` and `/credits/staff/456` exist in the wild (bookmarks, and
the app's own history entries). They should redirect rather than 404 — to
`…/studio/mal/123` and `…/staff/anilist/456`, which is correct for 100% of
existing rows per §2. Same pattern as the legacy MAL-numeric anime URLs that
`resolveByMalId()` already redirects.

### 6.7 Call sites that emit credit links

All must learn to pass the source. None currently has to reach for it — every one
already holds the record or a row derived from it.

| Site | File |
|---|---|
| Detail page studio chips | `pages/anime/[id].tsx:224` |
| Detail page staff rows | `pages/anime/[id].tsx:398` |
| `/stats` `linkFor` | `pages/stats.tsx:300-301` |
| Global search dropdown | `components/GlobalSearch.tsx:37,38,160,176` |

`globalSearch.ts` additionally builds a **credit index keyed by id**; with two
namespaces it either qualifies its hits or merges by name, which is §6.3 again in
a second place.

### 6.8 `/stats` aggregation buckets

`stats.ts` counts distinct anime per studio id. Mixed namespaces split a studio
into two rows in the top-50 — visible, unlike the silent IDF fragmentation, but
still wrong. Whatever unification rule §6.3 lands on has to apply here too, or
the stats page and the credits pages disagree about what a studio is.

### 6.9 Ordering relative to the catalog crawl

The crawl is what makes this real. Two sequences:

- **Fix first, then crawl** — nothing ever fragments; the fix ships against a
  dataset where it is unobservable, so it cannot be validated end-to-end until
  after the crawl.
- **Crawl first, then fix** — the fix is testable against real mixed data, at the
  cost of a window where recommendations are quietly skewed by split studios.

A third option: run the crawl into a **scratch copy** of the store, measure the
actual MAL/AniList studio-id overlap on real rows, then decide. That is the only
path that answers §6.3 with data instead of guesswork, and it is cheap — the
`/stats` work already established the scratchpad-copy pattern.

## 7. Open questions

1. Split-vs-merge (§6.3) — is one real studio allowed to be two pages?
2. Do the IDF consumers follow the route's identity rule, or keep their own?
3. Are producers in scope, and if so is a cast-slice-backed lookup acceptable?
4. Qualify all credit types, or only genuinely multi-source ones (§6.2)?
5. Sequence relative to the catalog crawl (§6.9).

## 8. Non-goals

- Canonical ids for studios/staff (option E) — deferred, not rejected.
- An internal seiyuu credits page (§6.5).
- Any change to anime canonical ids, the registry, or catalog precedence. This
  document is strictly about **secondary entity** identity.
