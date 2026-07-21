# Provider parity — the gap inventory

> A **gap inventory + ranked fixes** document.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `WIP`** — A1, G1, C1 `Done` (2026-07-20); H1, B1, B2, B4, D2, A2, D1
> `Done` (2026-07-21); B3 `Dropped` (assessed, deliberately deferred). **E1–E4
> and F1 are what remains.** D2 landed the capability descriptor; A2 and D1 then
> consumed it — neither as the one-line swap D2 had left ready (see both).
> B4 was **not in the original inventory** — it came from asking whether the
> keyless promise actually holds for the reco feed. It did not. See [B4](#b4--the-recommendation-feed-was-unreachable-without-a-mal-account--done-2026-07-21).
> Companion to [PROVIDER-FREE.md](PROVIDER-FREE.md) (which delivered the shift
> this document measures against) and [PROVIDER-ABSTRACTION.md](PROVIDER-ABSTRACTION.md)
> (whose dropped registry is **not** what this proposes — see [§3](#3-the-unifying-fix)).
> [DATA-LAYOUT.md](DATA-LAYOUT.md) depends on H1 here and covers the on-disk
> reorganization, which is deliberately out of scope for this inventory.

## 1. Thesis

The app finished a shift to **local ids + local records**. Under the model that
came out of it:

- **AniList-unauthenticated is the default catalog provider** — it is what makes
  the app usable with no account and no API key.
- **Every personal-list provider is an opt-in peer** — MAL, SIMKL,
  AniList-OAuth, and the in-app `local` provider. None of them is the spine.
  The local record is.

The **cores** were generalized to match. `computeDiscrepancy` takes a
per-provider map. `writePersonal` fans out over a writer registry. `toAnimeRecord`
walks a precedence list. `getEffectiveStatus`/`Score`/`Progress` read the
hydrated block rather than any one provider.

The **feeders, adapters and UI were not.** That is the whole of this document.

Every gap below is one of three shapes:

- **Generic core, hardcoded feeder** — the engine loops providers; its only
  caller names three of them positionally.
- **A MAL-era assumption frozen into a constant** — true while MAL was the
  identity spine, false since the canonical-id cutover.
- **An asymmetry that is silent instead of declared** — a provider cannot do
  something, and nothing in the system says so, so the UI reports success.

The exemplar is worth stating in full, because it is the pattern in miniature.
AniList is missing from the discrepancies page. But:

- [`computeDiscrepancy`](../src/lib/discrepancy.ts) is N-provider by
  construction, and its own header comment promises *"`local` — and later
  Betaseries / AniList — participate without touching this logic again"*.
- [`discrepancies.tsx`](../src/pages/discrepancies.tsx) already declares
  `PROVIDER_ORDER = ['mal', 'simkl', 'local', 'anilist']`.

Both ends support AniList. The only thing that does not is the ~40-line adapter
between them. **A generic core starved by a hardcoded feeder** — not a missing
feature.

## 2. Gap inventory

Ranked by damage-per-effort. Group letters are stable ids for cross-referencing;
they are not a sequence.

### A. Generic core, hardcoded feeder

Highest ratio in the codebase: the expensive half is already built.

#### A1 — `buildProviderStates` omits AniList — **`Done` 2026-07-20**

**Evidence:** [store.ts:532](../src/lib/store.ts) —
`buildProviderStates(mal, simkl, local, personalPrecedence)`, three positional
provider params, no `anilist` branch. `anilistPersonal` is in scope and passed
to `toAnimeRecord` at [store.ts:607](../src/lib/store.ts), one line after the
`computeDiscrepancy` call that ignores it.

**Symptom:** AniList never appears on `/discrepancies`, never triggers the
`disc` filter, never shows a `DiscrepancyBadge`. A user whose AniList list
disagrees with MAL is told the two agree.

**What shipped — three findings the inventory's "small, one function" missed:**

1. **The real defect was a duplicated mapping, not a missing branch.** The
   slice → status/score/progress mapping existed *twice*: `personalFrom*` in
   `animeUtils.ts` for hydration, and inline branches in `buildProviderStates`
   for discrepancy. `ProviderPersonalState` is a strict superset of
   `AnimePersonal` (it adds `present` and `total`), so the two were the same
   function with different lossiness — and a provider added to one was not added
   to the other. That is the actual mechanism by which AniList ended up hydrated
   but invisible. Both now come from one extractor table in the new
   [personalState.ts](../src/lib/personalState.ts); hydration narrows via
   `toAnimePersonal`. Adding a provider is one row, and it is not possible to add
   it to one consumer only.

2. **The gate was the hard part, and it was dissolved rather than built.** The
   slice was filled by two paths with different actionability — OAuth login and
   the anonymous by-username import — so including AniList appeared to need a
   token gate (`store.ts` said so; so did ANILIST-OAUTH.md). Instead the
   **anonymous by-username import was removed entirely**: post-OAuth it read a
   list the user could not write back to, and it was the only way the slice could
   be filled by someone with no AniList connection. With it gone, an entry always
   belongs to a connected account, so there is nothing to gate. Removing a
   feature was cheaper and more correct than adding the conditional.

3. **Participation is now expressed once.** A provider is in the map iff it
   appears in the resolved `personalPrecedence` — the same list that decides who
   can win a hydrated field. Previously `local` was gated that way ad hoc and the
   others were unconditional. This is the predicate D2's capability descriptor
   should replace when it lands.

**Two defects caught by testing the new path rather than assuming it:**

- **Presence meant "the slice has a key", which is not the same as "the user has
  an entry."** The AniList and local writers reflect a push by upserting an entry
  keyed on the provider id, and a patch carrying only a cleared score leaves an
  entry with no personal dimension at all — live-observed in the real store as
  `{"a_31": {"anilist_id": 198409}}`. Admitting AniList would have made that
  artifact raise a phantom "present on AniList, absent from MAL" split. The rule
  is now `hasPersonalData`, asked of every provider **except MAL**, which keeps
  its stricter `!!status`: MAL's own artifact shape is `{status:'', score:8}`,
  which `hasPersonalData` would admit and `!!status` correctly rejects. Verified
  inert on the real store — 0 of 646 SIMKL entries change presence; the only
  entry affected anywhere is the one AniList artifact above.
- **The fully-watched reconciliation used `progress === total`, which breaks for
  a provider borrowing another's episode count.** AniList's personal entry has no
  total of its own, so it borrows the catalog's: MAL says 12 episodes, AniList
  says you watched 13 of its own 13, and `13 !== 12` flagged a progress
  disagreement — the exact count disagreement the exception exists to absorb.
  Now `>=`. Watching past the total is never itself a progress disagreement.
  Also verified inert on today's data: 0 rows across both stores have any
  provider reporting progress above its total, which is the only case where the
  two operators differ.

**Also in this pass:** `MALListStatus` extracted as a named model type (MAL's
`my_list_status` was the one anonymous inline personal shape, and `store.ts`
carried a private duplicate of it). **One deliberate behaviour change:** MAL's
empty status string (`''`, seeded by the write path before a score-only patch)
now normalizes to `undefined` in hydration, as it always did in the comparison.
It previously counted as a defined value, so it could win the precedence merge
and make an unstatused title read as statused. Latent on the real store — a
25,370-row before/after diff of the hydrated `personal` block showed **zero**
differences, so the refactor is behaviour-preserving on today's data.

**Follow-up this exposed (not fixed here):** `AniListPersonalEntry` carries no
`episodes` count, which is why it borrows MAL's. The `>=` relaxation absorbs the
symptom; storing AniList's own total from the import query would remove the
guess. Same shape as the rest of this document — one provider's data forced
through another provider's units. Small, and worth doing when AniList personal
data grows past one account's list.

**Size:** was "small, one function, no consumer changes" — actually a shared
extractor module, a feature removal, and its UI/locale/API surface.

#### A2 — `PRESENCE_ANCHORS = ['mal']` — **`Done` 2026-07-21**

**Evidence:** [discrepancy.ts:36](../src/lib/discrepancy.ts).

**Symptom:** presence detection asks *"present somewhere, absent from MAL?"*.
On an install with no MAL connection there is no anchor, so no presence split can
ever be reported. The comment says to *"extend this set when a second full-list
writable provider lands"* — AniList-OAuth landed and the set was not extended.

**Why it is not simply `['mal', 'anilist']`:** the asymmetry exists because MAL
was the comprehensive list while SIMKL/local were subset feeds; a symmetric rule
would flag the entire catalog. That reasoning is still sound, but "which
providers claim to hold a full list" is a **capability**, not a constant. This
gap is the clearest argument for [§3](#3-the-unifying-fix).

**Size:** small as a constant edit; correct as a capability read.

**What shipped — and the one-line swap D2 left ready is NOT what shipped:**

1. **`PRESENCE_ANCHORS = fullListProviders()` is wrong, measurably.** D2 declared
   `listCoverage` (MAL and AniList `full`) and left the swap as a line. Measured
   against the real store first, that line reports **430 of 671** tracked titles
   as a presence split — every MAL entry the smaller, later-connected AniList
   account (241 entries) happens not to hold. That is precisely the failure the
   original asymmetry existed to prevent, re-created one level up: with two
   mutual anchors, "absent from a reference list" degenerates into "the two lists
   differ", which is most of the list.
2. **The descriptor field was right; what it means was conflated.**
   `listCoverage: 'full'` is an **API** claim — this provider's read returns the
   account's entire list rather than a subset feed (AniList's
   `MediaListCollection` genuinely does). It is *not* a claim that this account
   IS the user's comprehensive record, which is what presence detection needs.
   So the anchor is now **one** provider, not the set: `presenceAnchors()` takes
   the first full-list provider **in the resolved personal precedence** — the
   list where the app already states which provider it believes when they
   conflict. MAL + anything → `['mal']` (today's behaviour, preserved); no MAL →
   `['anilist']`, which is A2's stated symptom fixed; SIMKL-/local-only → `[]`,
   nothing claims completeness so an absence is not news (previously a dangling
   `['mal']`).
3. **Presence detection had silently stopped firing altogether** — found while
   wiring this, not from the inventory, and it is the larger half of what A2
   actually fixed. The check reads `states[p] && !states[p].present`, so an anchor
   can only be reported absent if it has a *state*. Pre-H1 MAL always had one: its
   personal state rode on the catalog slice, which exists for every catalogued
   title. **H1 split it out**, and `personal/mal.json` holds only *statused*
   titles — so a title absent from the MAL list now produces no `mal` state and
   there is nothing to test. Zero presence splits were reportable on any install.
   Measured at HEAD on the real store: **0**, where the two titles below should
   have flagged. (H1's writeup reports a 0-change before/after diff of every row's
   `discrepancy` block, so this slipped through it; a diff cannot see a feature
   that goes quiet, only one that changes its answer.) The anchor now always gets
   a state — `present: false` when it holds nothing — which is the other reason
   this could not be the constant edit D2 left ready.
4. **The anchor rides on the state (`ProviderPersonalState.anchor`)** rather than
   becoming a second argument to `computeDiscrepancy`. The comparison stays a
   pure function of what it is handed, which the discrepancies page depends on:
   it re-runs the same function client-side over a *filtered* subset of these
   states, and unchecking the anchor provider there correctly removes the
   anchoring with it.

**Verified on the real store** — two production builds of the same tree, HEAD and
this change, run against the same store on the same endpoint
(`/api/anime/animes?discrepancies=true&limit=all`), 2026-07-21:

| | rows | presence splits | status / score / progress disagreements |
|---|---|---|---|
| HEAD | 2 | **0** | 0 / 0 / 2 |
| this | 4 | **2** | 0 / 0 / 2 |

The 2 recovered rows are `a_22208` "Sayonara Lara" and `a_23793` "Star Wars:
Visions Presents - The Ninth Jedi", both `present: [simkl, anilist], absent:
[mal]` — and both exactly what a raw scan of the four personal slices reports as
tracked-somewhere-but-absent-from-the-MAL-list (2, independently). Every row
carries `anchor: true` on `mal` and on nothing else. The pre-existing progress
disagreements are byte-identical, and the hydrated `personal` block is untouched
(the anchor placeholder narrows to `{}` and cannot win a precedence merge).

### B. MAL as a mandatory join key

These block the provider-free promise directly: the no-account path creates
records that the rest of the system cannot process.

#### B1 — AniList enrichment is queryable only by MAL id — **`Done` 2026-07-21**

**Evidence:** [anilistSync.ts:32](../src/lib/anilistSync.ts) — `media(idMal_in:
$ids, type: ANIME)` in `TAGS_QUERY`; same at
[anilistSync.ts:190](../src/lib/anilistSync.ts) for `RECS_QUERY`. Both batch
helpers take `malIds: number[]`.

**Symptom:** the sharpest gap in the inventory. `performAnilistBulkCatalogCrawl`
is the onboarding path for a keyless install — and
[`getAnilistCatalogCrawlStats`](../src/lib/anilistSync.ts) literally reports an
`anilistOnlyIds` count. Those titles can never receive tags, staff, relations, or
AniList crowd recommendations, **from AniList, using an AniList id the record
already holds.** The catalog crawl mints records its own enrichment cannot reach.

Downstream: no relations means no franchise edges, so `/quick-rate` cannot group
them; no tags/staff means the `anilistTags`/`anilistStaff` reco sources score
them at zero.

**Fix:** query by `id_in` for records carrying `crosswalk.anilist`, keeping
`idMal_in` for the rest. AniList accepts either. Mind the caveat already
documented for the cast query — send only the id you have, never the other as an
explicit `null`, which AniList applies as a real filter.

**Size:** medium. Touches the batch query shape and the id-selection logic, not
the storage or hydration.

**What shipped:**

1. **The query body is now built twice from one template**, `idMal_in` and
   `id_in`. A batch is homogeneous by construction — the caveat this document
   already cites (AniList applies a supplied-but-null argument as a real filter)
   means a query carries exactly one id filter, so the id space is a parameter of
   the *batch*, not of a title.
2. **The bigger half was the feeder, not the query** — the same shape §1 warns
   about. `performAnilistMetaSync` scanned `getAllAnime()`, the MAL catalog
   slice, so it was structurally incapable of *naming* a title MAL doesn't know,
   no matter which filter the query offered. It now scans the **registry** — the
   identity spine every slice hangs off — and looks coverage up by canonical id
   directly, which is what makes "every title we know of" mean every title.
   MAL id wins when a title has both: it is the key the catalog is anchored on,
   and a crosswalk's `anilist` can be a mirrored SIMKL value while `mal` is the
   id the record was built from.
3. **Relation edges stored both ids.** `AniListRelationEntry.idMal` was
   required, and `parseRelations` dropped any edge whose target had no MAL id —
   so the franchise graph would have kept losing exactly the titles this fix
   reaches, *after* the query was fixed. Both ids are now optional-with-one-
   present (`id` is always there — the edge came from AniList), and
   `groupIntoFranchises` carries a second AniList→canonical index, MAL-first.
4. **`fetchAnilistRecommendations` was deliberately left MAL-keyed.** Its only
   consumer is the reco engine, which is MAL-keyed end to end (B3). An `id_in`
   path there would return edges the engine has no key to store or rank; it moves
   when B3 moves. Noted in the code at `RECS_QUERY`.

**Verified.** *Live against AniList* (2026-07-21): three genuine AniList-only
titles (`al:203275` Demons' Crest, `al:187990`, `al:213298` — no `idMal`) return
**0 media** through the old `idMal_in` query and **3** through `id_in`, carrying
tags, staff, banner and relations; the query stays under the complexity ceiling
at the unchanged `perPage:50`. A title that *does* have a MAL id round-trips it
through `id_in` (`al:1` → `idMal:1`), so the two paths agree where they overlap.
*Against the real store*: it is **inert** — that install is MAL-anchored (0 of
25,382 registry entries are AniList-only), and the registry scan queues the
**identical** 6,085 ids as the old catalog scan, set-equal in both directions.
The new capability activates only where the gap was: a keyless install.

**One claim not reproduced:** the relation-edge widening measured **0 recovered
edges** in a live 50-title sample (40 anime edges, all targets carrying a MAL
id). MAL-less relation *targets* are rare in the popularity head. It is kept as
cheap correctness insurance for the keyless catalog, not as a measured win.

#### B2 — Single-title refresh derives every source from the MAL id — **`Done` 2026-07-21**

**Evidence:** [refresh.ts:55-67](../src/pages/api/anime/animes/[id]/refresh.ts) —
`getMalIdForCanonical(canonicalId)` gates the MAL refill *and*
`refreshAnilistMetaForIds([malId])`, while `anilistId` is read at line 59 and
passed only to the cast fetch.

**Symptom:** the `RefreshButton` on a MAL-less title is a no-op for AniList
metadata, even though the AniList id is resolved three lines above.

**Fix:** falls out of B1 — once meta refresh accepts an AniList id, route it
through. Independently correct even before B1's batch path.

**Size:** small, once B1 exists.

**What shipped:** exactly that — `refreshAnilistMetaForIds` takes the id space as
a parameter, and the handler passes the MAL id when it has one, the AniList id
otherwise. Two details the inventory did not name:

- **The AniList id needed a second source.** `refresh.ts` read it from the meta
  slice, which is filled *by the very sync this refresh triggers* — so on the
  case B2 is about (a title enrichment has never reached) it could be absent
  where the registry crosswalk has it. It now falls back to the registry, the
  same resolve-order `getMalIdForCanonical` uses for MAL.
- **`refreshAnilistMetaForIds` filtered its own results on `m.idMal`**, which
  would have discarded every AniList-only title the new path fetched. Keyed on
  `m.id` now. A one-word bug that would have made B2 look like it worked while
  persisting nothing.

Both MAL-less outcomes stay distinguishable in the response: `NO_MAL_ID` for the
MAL refill, a separate "no MAL or AniList id" outcome for the metadata one — a
title with neither is a SIMKL-only record AniList has no handle on.

#### B3 — The recommendation engine is MAL-keyed — **`Dropped` 2026-07-21**

**Evidence:** `computeFeed`/`computeSimilarTo` in
[recommendations.ts](../src/lib/recommendations.ts) build an internal
`Map<number, AnimeRecord>` keyed on `crosswalk.mal`.

**Symptom:** an AniList-only title can neither appear in the feed nor act as a
seed, regardless of how well it matches the taste profile.

**Assessment:** this one is **deliberate and defensible**, and is documented as
such in CLAUDE.md and PROVIDER-FREE-CUTOVER.md — MAL/AniList crowd edges,
suggestions, and `recommendations.json` all arrive as MAL ids, so the join key is
inherited from the data, not chosen. Listed here for completeness of the
inventory, **not** as a recommended fix. Revisit only if AniList-only titles
become a large share of the catalog. Cost is high (a crosswalk-resolving map plus
a cache-file migration) and the benefit is bounded by how many crowd edges
resolve without a MAL id at all.

**Size:** large. Recommend deferring.

**Decision (2026-07-21):** deferred as recommended, and marked `Dropped` rather
than left `Todo` so it stops reading as pending work — this entry is an
*assessment*, not a fix awaiting a turn. Nothing was rewritten. Two things were
done instead, both of which make the boundary legible rather than moving it:

- `RECS_QUERY` in `anilistSync.ts` now states in code *why* it stays MAL-keyed
  while its neighbour `TAGS_QUERY` gained an AniList-id path — the two sit ten
  lines apart and the asymmetry would otherwise read as an oversight, which is
  precisely the "silent instead of declared" shape §2.D warns about.
- The revisit trigger stays as stated: AniList-only titles becoming a large share
  of the catalog. On the current store that share is **0 of 25,382**, so the
  benefit is still bounded by roughly nothing.

#### B4 — The recommendation feed was unreachable without a MAL account — **`Done` 2026-07-21**

**Not in the original inventory.** It surfaced from a reader's question that this
document could not answer — *"does the reco engine work without MAL?"* — and the
honest answer was no, for a reason B3 does not name. Worth recording as its own
item because **B3 was the decoy**: the visible MAL-ness of the engine is its id
keying, and that is the part which does *not* block a keyless install.

**The distinction that matters: MAL *ids* ≠ MAL *auth*.**

- MAL ids come free off AniList's own payload (`idMal`), no account, no key. So
  the engine being MAL-*id*-keyed costs a keyless install almost nothing — on the
  real store 0 of 25,382 titles lack a MAL id. That is B3, and it stays deferred.
- MAL *authentication* was a hard gate on the one route that fills the cache.
  That is this item, and it made the entire feature unreachable.

**Evidence:** [refresh.ts:24](../src/pages/api/anime/recommendations/refresh.ts) —
`requireMalAuth(res)`, a 401; `performRecommendationsRefresh(accessToken, …)`
took the token as a required first argument; and the client gated too
(`if (!authState.isAuthenticated) return`, plus a `disabled` refresh button).

**Symptom:** on a keyless install the feed could never be populated, so it was
permanently empty — while `similar/[id]` ("Plus comme ça"), which asks the same
question about one title, worked fine with no account.

**The precedent was already in the repo.** `similar/[id]` treats the MAL token as
optional, runs the anonymous AniList crowd source regardless, and returns a
per-source outcome. The feed refresh is that same shape with the graceful half
missing — a *silent asymmetry* in the §2.D sense, one file away from its own
correct precedent, exactly as D1 is.

**What shipped:**

1. **MAL became optional, per source.** `accessToken: string | null`; the two MAL
   sources (crowd edges, personal suggestions) are skipped with a stated reason,
   the AniList crowd source always runs, and the niche 2-hop follows the MAL
   crowd source it rides on. A new `RecoRefreshSources` is returned and put on the
   terminal SSE event, so a degraded run is *declared* rather than just thinner.
2. **Hydration had to move too, and this was the load-bearing half.** A candidate
   with no local record is dropped by `computeFeed` — there is no metadata to rank
   it on — so hydration decides whether the feed has *content*, and it was
   `fetchAnimeDetail`, MAL-only. Keyless runs now hydrate via
   `fetchAnilistCatalogByMalIds`: candidates already carry MAL ids, AniList
   queries by MAL id happily, and the result lands as a `catalog` block through
   the same `upsertAnilistCatalogFields` the season crawler uses — 50 titles per
   request instead of one. Without this the route would have returned 200 and
   produced an empty feed, which is a worse failure than the 401 it replaced.
3. **The client gates went with it**, including the now-dead MAL auth probe on
   `/recommendations` (the page fetched auth status solely to disable a button).

**Verified end-to-end on a synthetic keyless store** (2026-07-21): 10
AniList-crawled titles, 4 in-app ratings as seeds, **no `auth/mal.json` at all**,
run against a production build.

- `POST …/refresh` → **200** (was 401).
- Terminal SSE event: `malCrowd` and `malSuggestions` both
  `{ok:false, skipped:true, reason:"No MAL account connected"}`, `anilistCrowd`
  `{ok:true}`, `hydration` `{ok:true, via:"anilist"}`.
- Feed went 0 → **53 ranked items**, correctly ordered by affinity (Samurai
  Champloo / Trigun / Space Dandy off the Cowboy Bebop seed; Re:ZERO / ERASED off
  Steins;Gate), each with a real breakdown (`anilistCrowd` + `popularity` +
  `genre`).
- Registry grew 10 → 67, `catalog/anilist.json` to 67 entries, and
  **`catalog/mal.json` stayed at 0** — no MAL write path was touched. Every
  hydrated title's catalog provenance reads `anilist` across all 14 fields.

**Not verified:** the MAL-connected path is unchanged *by construction* (the
original body now sits under `if (accessToken)`) but was not re-run live — that
needs a real MAL token.

**Known gap left open:** the per-source outcomes are returned and streamed but
**not rendered**. The complete-event message names the degraded mode, and the
client clears it on completion. Surfacing "MAL skipped" durably in the sidebar is
UI work that belongs with E1–E4's uniform provider cards, not bolted on here.

**Size:** medium — small at the gate, medium once hydration had to gain a second
provider.

### C. Personal state still displayed MAL-only

#### C1 — List views bypass the effective-value seam — **`Done` 2026-07-20**

**Evidence:**
[AnimeCardView.tsx:102](../src/components/anime/AnimeCardView.tsx) —
`anime.sources.mal?.my_list_status?.status ?? ''`;
[AnimeTable.tsx:168-178](../src/components/anime/AnimeTable.tsx) — the same for
status, score and progress.

**Symptom:** a SIMKL-only, AniList-only or local-only user sees an **empty status
and score column on the main list**, while `/tier`, `/stats` and `/quick-rate`
— which all go through `getEffective*` — show the data correctly. The main page
is the one place the app looks empty for a non-MAL user.

**Status change:** CLAUDE.md documents this as *"a conscious deferral"*, on the
reasoning that the card shows an explicit "MAL status" label and surfaces other
providers via the discrepancy badge. That reasoning held while MAL was the spine
and every install had one. Under local-record authority with MAL opt-in, it is
no longer a deferral — it is the default view being wrong for a supported
configuration. **This document reclassifies C1 from deferred to a defect.**

**Fix:** route through `getEffectiveStatus`/`Score`/`Progress`, as every other
surface already does. The per-provider detail stays available via the
discrepancy badge, which is where it belongs.

**Caveat:** the inline-edit path in `AnimeTable` writes MAL fields optimistically
(`updates?.status ?? …`). Reading effective while writing MAL-shaped needs the
optimistic overlay reconciled, or an edit will appear to revert.

**What shipped:**

1. **Both views route through `getEffective*`.** `AnimeCardView`'s status badge
   and `AnimeTable`'s three "Moi" reads (status / score / progress). The staged
   per-row `pendingUpdates` overlay is unchanged and still wins; only its
   *fallback* moved off `sources.mal`. `getEffectiveScore` maps unrated to
   `undefined` (via `toAnimePersonal`), so the score select keeps `?? 0` to stay
   on its "no score" option.

2. **The caveat was real, and worse than stated.** The overlay didn't merely need
   reconciling — it was guarded by `a.sources.mal &&`, so on a title with *no MAL
   slice* (exactly the SIMKL-only case C1 exists to fix) it was skipped entirely
   and the committed edit reverted on the spot. The overlay now patches
   `record.personal`, which is what the views read. Normalization matches
   hydration: `status: ''` and `score: 0` become `undefined`, not stored zeros.

3. **The MAL-shaped naming went with it.** The endpoint has been provider-agnostic
   since it became a `writePersonal` wrapper, so `onUpdateMALStatus` →
   `onUpdatePersonalState`, `MALStatusUpdate` → `PersonalStateUpdate`,
   `getMALStatusClass/Icon` → `getStatusClass/Icon`, and the CSS classes
   `malStatus`/`malScore`/`malEpisodes`/`malStatusLabel…` → `personal*`. Locale
   key `table.updateMalStatus` → `table.updatePersonalState` ("Mettre à jour mon
   statut"). The wire field `num_episodes_watched` **stays** — it is the
   endpoint's contract, not a display concern. Leaving `mal*` names on a
   now-effective value would re-plant the exact confusion this fixed.

**Verified against the real store:** the change is inert for a MAL-connected user
— across 25,382 rows, **0** score-value changes and **0** progress-value changes;
it newly fills 2 status rows and 1 score row, all SIMKL-only titles that rendered
blank before. Live-checked on a production build (`next dev` does not hydrate):
`a_22208` "Sayonara Lara" — no MAL slice — now shows `watching` + `1/12` from
SIMKL in both layouts, with correct status styling and no hydration warning. The
commit path was exercised with a stubbed `fetch` (no write left the browser): one
`{"score":8}` request, pending map cleared, value **held** at 8 afterwards — the
revert the caveat predicted, confirmed fixed.

**Dead CSS swept in the same pass:** the rename exposed `.malStatusCell` /
`.malScoreCell` / `.malEpisodesCell` as unreferenced — leftovers from an earlier
table layout, never rendered (a CSS Module class with no TSX reference cannot
apply to anything, since the class names are hashed). Auditing the sibling `*Cell`
rules while there found `.genresCell` dead as well, including its `max-width`
override in the ≤1600px media query — genres have moved inside the title cell
(`.genresInTitle`). All four deleted; `.episodesCell` / `.seasonCell` are live and
were kept.

**Size:** was "small to medium" — accurate, with the optimistic path the larger half.

**Unblocks:** H1, which noted C1 first "removes three of its readers" — it does;
`sources.mal.my_list_status` now has three fewer consumers.

### D. Silent asymmetries

The category that motivates the capability descriptor: in each case a provider
cannot do something, and the absence is invisible rather than stated.

#### D1 — SIMKL reports success for writes it discards — **`Done` 2026-07-21**

**Evidence:** [personalWriters.ts:147](../src/lib/personalWriters.ts) —
`if (patch.score === undefined) return { ok: true, matched: false };`

**Symptom:** SIMKL is score-only by design. A status or progress patch is
dropped, but reported as `ok: true`. The tier board and `PersonalStateEditor`
both iterate the outcomes map looking for `ok === false` — so a discarded write
renders as a success. The `matched: false` flag carries the truth and no consumer
reads it.

**Contrast with the good precedent, one file away:** clearing a status returns
`{ ok: false, error: 'MAL cannot clear a status (list removal only)' }` — an
explicit, surfaced refusal. D1 is the same situation handled the opposite way.

**Fix:** report unsupported dimensions as an explicit outcome rather than a bare
success, and have the UI distinguish *failed* from *not applicable*. Cleanest as
a capability read (below), but correctable standalone.

**Size:** small.

**What shipped:**

1. **The patch is narrowed once, in the registry, from the descriptor.**
   `writePersonal` intersects the patch's dimensions with `supportedDimensions(id)`
   before either pass, so a writer no longer needs to know its own capabilities —
   SIMKL's two hand-rolled `if (patch.score === undefined)` guards are what D1
   *was*. A provider that can take part of the patch takes that part; one that
   can take none is never called, locally or remotely.
2. **The discard is now in the outcome**: `unsupported: PersonalDimension[]`, plus
   `skipped` when the whole patch was inapplicable. `ok` stays **true** — nothing
   failed, and conflating "declined a dimension it never claimed" with "the push
   didn't land" would just move the lie. That distinction is the item: the
   outcomes map went from two states to three (*applied* / *partial* / *failed*).
3. **The UI reads the third state.** `PersonalStateEditor` renders unsupported
   dimensions as a **muted note** naming them, separate from the red failure list
   it already had. It is the only surface that can produce one — the tier board
   writes score-only and quick-rate always includes a score, so SIMKL applies
   something in both; a status-only edit from the detail page is the case that
   used to report a bare success.
4. **Clearing a status was deliberately left as it was** (`ok: false` with a
   reason). It is not the same shape: `status` is a dimension MAL and AniList both
   *do* claim, and clearing is a shape of it they refuse — an explicit refusal was
   already the good precedent this item was measured against. Both codepaths are
   now named in `personalWriters.ts` so the two are not confused later.

**Verified on a synthetic store** (production build, 2026-07-21) — synthetic
because the test needs SIMKL *enabled* while contacting no real service: one
title with MAL + SIMKL personal entries and a fabricated SIMKL token.

- **Wholly unsupported.** `PUT …/mal-status {"status":"completed"}` → `simkl:
  {ok:true, matched:false, skipped:true, unsupported:["status"]}`, where it used
  to answer a bare `{ok:true, matched:false}`. `personal/simkl.json` is byte-
  identical afterwards and no SIMKL request is attempted — the skip happens
  before either pass.
- **Partial.** `{"status":"completed","score":9,"num_episodes_watched":26}` →
  `{ok:false, error:"Not authenticated with SIMKL", unsupported:["status","progress"]}`,
  and the local SIMKL entry took the **score only** (status/progress unchanged at
  `watching` / 3). Run with the synthetic token aged past expiry on purpose: token
  *presence* keeps SIMKL enabled while `isSimklTokenValid` short-circuits the push
  offline, so the partial-merge path is exercised with no outbound call. It also
  shows the two signals composing rather than competing — a real failure and a
  declared discard on the same outcome.

#### D2 — No capability descriptor; enablement logic duplicated — **`Done` 2026-07-21**

**Evidence:** [providers.ts:31](../src/lib/providers.ts) — `hasWritableExternal()`
hand-reads three auth files. [personalWriters.ts](../src/lib/personalWriters.ts) —
each writer's `isEnabled()` repeats the same token check for its own provider.
The two must be kept in agreement by hand; the `hasWritableExternal` comment
records that it was *"extended per registered writer"* when AniList OAuth landed,
which is the maintenance cost made explicit.

**Symptom:** there is no single place that answers *"what is this provider, and
what can it do?"* — so every surface that wants to render or branch on a provider
re-derives it, which is the mechanism behind A2, D1, and all of E.

**Size:** medium. This is [§3](#3-the-unifying-fix).

**What shipped:**

1. **Two modules, split on client-safety, not on subject.** The declarative half
   is the new [providerCapabilities.ts](../src/lib/providerCapabilities.ts) —
   static data, no fs, no auth reads — so the connections UI (E) can import a
   provider's shape directly. The runtime half ("is it connected *right now*?")
   stays in [providers.ts](../src/lib/providers.ts), server-only, and is where
   the two compose. Every question of the form *"who can do X?"* is answered
   there and nowhere else.
2. **Roles are keys, and each role carries its OWN auth kind.** §3 below listed
   *auth kind* as one field per provider. That is wrong for AniList, and
   discovering it was the useful part of this item: AniList's **catalog** role is
   `anonymous` (the tags/staff sync and the bulk season crawl need no account and
   no key — it is the whole keyless promise) while its **personal** role is
   `oauth+secret`. A single per-provider auth field would have encoded "AniList
   requires OAuth", which is exactly E4's mistake — filing an unauthenticated
   catalog action under an account section — frozen into the descriptor that is
   supposed to fix it. So a provider holds `catalog?` and/or `personal?`, role
   presence is key presence, and auth is per role.
3. **The duplication is gone by removal, not by indirection.** Writers no longer
   carry `isEnabled` at all; the registry filters on
   `isPersonalProviderEnabled(w.id)` — one predicate, which `hasWritableExternal`
   is now also a query over. A writer can no longer disagree with it. And because
   descriptors are a `Record<ProvenanceSource, …>`, registering a writer without
   a descriptor row is a compile error rather than something to remember.
4. **One consumer moved to the descriptor, as a demonstration that it is load-
   bearing.** The detail page's `canClearStatus` was `!hasWritableExternal()` —
   the right answer from the wrong question, since it assumed no external
   provider could *ever* clear a status instead of reading whether one declares
   it. It is now `canClearStatus()`: every **enabled** provider declares
   `personal.clearStatus`. Same answer on every configuration that exists today.

**Deliberately NOT wired — these are A2 and D1, and both are behaviour changes:**

- `listCoverage: 'full' | 'subset'` is declared (MAL and AniList `full`; SIMKL
  and local `subset`) and `fullListProviders()` exists, but `PRESENCE_ANCHORS`
  still reads `['mal']`. Swapping it makes AniList a presence anchor — a real
  change in what the discrepancies page reports, which A2 owns and should verify
  against the store.
- `supportedDimensions()` / `supportsDimension()` are declared (SIMKL: `['score']`),
  but `simklWriter.writeRemote` still returns a bare `{ ok: true, matched: false }`
  for a status or progress patch. Refusing it explicitly is D1.

Doing either here would have made this item's diff a behaviour change wearing a
refactor's clothes. The data they need now exists; the swaps are a line each.

**Verified live on both branches** (production build, 2026-07-21) — the point
being that the two configurations differ in exactly the predicate that was
rewritten:

- *Real store, MAL + SIMKL + AniList all connected:* `/api/anime/settings`
  reports `hasWritableExternal: true`, `local` disabled, precedence
  `[simkl, mal, anilist]` — unchanged. The detail page (`a_23695`) renders the
  status row with **no** clear chip.
- *Synthetic keyless store (same data, `auth/` emptied):* `hasWritableExternal:
  false`, `local` enabled, precedence `[local, simkl, mal, anilist]`, and the
  same page renders the status-clear chip. `canClearStatus()` flips exactly where
  `!hasWritableExternal()` used to.

**Unblocks:** A2, D1, and E1–E4, which were all waiting on "what is this
provider, and what can it do?" having one answer.

### E. Connections UI: three bespoke shapes, one absent peer

#### E1 — Three provider-named sections with no shared shape

**Evidence:** [connections.tsx:20-42](../src/pages/connections.tsx) — hardcoded
`<h2>MyAnimeList</h2>` / `<h2>SIMKL</h2>` / `<h2>AniList</h2>` over
`AccountSection`, `SimklSection`, `AnilistAuthSection`. Three components, three
prop shapes, three layouts, for what is one concept.

**Symptom:** the page presents wildly different options per provider, with no
way to tell an intentional capability difference from an unimplemented one.

#### E2 — Three copies of the connection badge

**Evidence:** `MalConnectionBadge.tsx`, `SimklConnectionBadge.tsx`,
`AnilistConnectionBadge.tsx` — each a near-identical
fetch-status-on-mount-and-`routeChangeComplete` component over the shared
`ConnectionStatusBadge` presenter.

**Note:** the presenter was *just* generalized (an optional text `label` for
providers with no brand asset), which is the right direction — the duplication is
in the three stateful wrappers, not the presenter.

#### E3 — The local provider has no connections presence

**Evidence:** absent from [connections.tsx](../src/pages/connections.tsx)
entirely. Its only surface is the `localProviderEnabled` / `localPrecedenceMode`
settings keys.

**Symptom:** local is a full personal-list peer — it participates in precedence,
discrepancy and the writer registry — but a user cannot see that it is on, how
many entries it holds, or that it is what is holding their ratings on a keyless
install. On the default no-account configuration, the *only active provider* is
the one with no UI.

#### E4 — AniList's sub-features are filed by provider, not by role

**Evidence:** [useConnections.ts](../src/hooks/useConnections.ts) carries five
independent AniList state groups: OAuth, anonymous by-username import, meta sync,
catalog crawl, and push.

**Symptom:** two of those — **meta sync and catalog crawl — are catalog-role
actions with no authentication at all**, sitting under an account section.
Conversely `DataSyncSection` holds MAL's catalog actions. The page is organized
by provider identity when the user-meaningful axis is role: *what is my catalog,
and which lists am I syncing?*

**Fix for E1–E4:** one uniform card per provider, rendering from a declared
capability set, split into a catalog-role group and a personal-list-role group.
Local appears in the personal group with its auth slot marked not-applicable
rather than missing.

**Size:** medium-large, and the largest visible payoff. Depends on D2.

### F. Orchestration

#### F1 — cron-sync is MAL-only

**Evidence:** [cron-sync.ts:2-4](../src/pages/api/anime/cron-sync.ts) imports
`getMALAuthData`, `isMALTokenValid`, `performHistoricalCrawl`, plus
recommendations. No SIMKL, no AniList.

**Symptom:** scheduled sync does nothing for a SIMKL-only or AniList-only user.
CLAUDE.md acknowledges wiring the SIMKL delta into cron as deferred; AniList is
not mentioned at all, and now has both a metadata sync and a personal import
that would benefit.

**Note:** unlike E, this is *not* a candidate for a generic loop —
[PROVIDER-ABSTRACTION.md](PROVIDER-ABSTRACTION.md) is right that MAL's seasonal
crawl, SIMKL's two-phase delta and AniList's GraphQL batch are genuinely
different operations. The fix is three explicit calls, each guarded by its own
enablement check, not one abstracted one.

**Size:** small per provider.

### G. Documentation drift

#### G1 — CLAUDE.md understates the AniList integration — **`Done` 2026-07-20**

**Evidence:** CLAUDE.md's AniList OAuth section lists *"the authenticated
private-list read is not implemented yet"* as an open item.
[anilistPersonalSync.ts:228-246](../src/lib/anilistPersonalSync.ts) implements
exactly that: with no username and a live token it imports the viewer's own list,
private entries included, and passes the bearer token even on by-name reads.

**Symptom:** the doc understates capability, which matters because CLAUDE.md is
the map future work is planned against — a real feature reads as missing.

**Fixed alongside A1**, which is also what made the claim unambiguous: with the
by-username tier removed, the import *is* the authenticated private-list read,
rather than one branch of a dual-mode function. CLAUDE.md now documents it, and
`docs/mytodo.md`'s corresponding open item is closed.

### H. Structural asymmetry: MAL conflates catalog and personal

#### H1 — MAL's personal state lives inside its catalog payload — **`Done` 2026-07-21**

**Evidence:** every other provider stores personal state in its own slice file
with its own entry type — `SimklPersonalEntry` / `animes_simkl.json`,
`AniListPersonalEntry` / `animes_anilist_personal.json`, `LocalPersonalEntry` /
`animes_local_personal.json`. MAL alone embeds it: `MALListStatus` sits inside
`MALAnime` inside `animes_mal.json`, which is also the catalog.

**The justification does not survive contact with AniList.** The stated reason is
that MAL's API ships catalog and list status in one payload and the file is
stored as raw MAL JSON. But **AniList's API does exactly the same** — `Media`
carries `mediaListEntry`, and the list query returns media alongside entries —
and AniList is nonetheless split into `AniListMetaEntry` (catalog, tags, staff,
banner, relations) and `AniListPersonalEntry` (status/score/progress), in two
files. So the split is achievable against a combined API; MAL is simply the one
provider that predates the convention. **The asymmetry is legacy, not design.**

**What it costs today** — this is not cosmetic:

- **The presence exception.** MAL is the only provider whose `present` cannot
  mean "the slice has an entry", because its slice exists for every *catalogued*
  title. Hence `!!status` and the carve-out documented in `personalState.ts`.
  Split the file and the exception evaporates: presence becomes "there is a row
  in the personal slice", uniformly.
- **A rating write rewrites 39 MB.** `malWriter.writeLocal` calls `getAllAnime()`
  → mutate → `saveAnime()`, which serializes the *entire catalog* to record one
  score. It also bumps `animes_mal.json`'s mtime, invalidating the parse cache
  and every assembled row — for a personal edit that touched one field. The tier
  board's serial write queue does this per drag.
- **`MALAnime` cannot be typed as catalog.** `catalogFromMal` and
  `providerStateFromMal` both take the whole record because there is nothing
  narrower to take.

**Fix:** extract `my_list_status` into `animes_mal_personal.json` keyed by
canonical id, with `MALPersonalEntry` joining the other three. `MALAnime` becomes
pure catalog. One migration script; the write path, `malSync`'s
`updatePersonalStatusBatch`, and the readers of `my_list_status` follow.
**C1 already shrank this**: three of those readers were the list views, and they
now go through `getEffective*` (done 2026-07-20).

**What shipped — and one claim above that did NOT survive contact:**

1. **`MALPersonalEntry` = a type alias of the wire shape `MALListStatus`**
   (verbatim MAL field names). One shape, two roles: `MALListStatus` stays on
   `MALAnime.my_list_status` (the API still ships it inline); `MALPersonalEntry`
   is the stored slice entry. No field rename rode on the data migration.
2. **Split on ingest.** `upsertAnime` strips `my_list_status` off every incoming
   MAL record and routes it into the personal slice (clearing the entry when a
   fetch returns the title *without* a status — mirroring the old full-overwrite
   exactly, so a title removed from the MAL list still clears). The catalog file
   is pure catalog; the personal slice is the only thing a rating write touches.
3. **The presence carve-out did NOT evaporate.** This section predicted "split
   the file and the exception evaporates". It does not: split-on-ingest can still
   seed a `{ status: '' }` entry, so `providerStateFromMal` still keys presence on
   `!!status`, and `personalState.ts`'s `hasPersonalData` carve-out (MAL excepted)
   stays. What the split *did* remove are the two costs that were real — the 39 MB
   rating write, and `MALAnime` being untypeable as catalog. The claim is
   corrected here rather than the carve-out forced.
4. **Refuse-to-start guard.** There is no process-boot hook, so it is a one-time
   lazy guard on the first catalog read: post-split code never writes
   `my_list_status` into the catalog, so finding one embedded throws with the name
   of the migration script. Live-verified — an un-migrated store 500s every list
   request with the named error; the migrated store serves normally.
5. **A per-provider-total fix shipped alongside** (out of H1's literal scope, but
   the split exposed it). The fully-watched reconciliation borrowed
   `mal.num_episodes` as *every* provider's episode total — hardcoding MAL as the
   catalog authority in the one spot the provider-free direction says is AniList's.
   Now each provider is judged against its OWN catalog's count (MAL vs MAL's,
   AniList/local vs AniList's, SIMKL vs its own). That surfaced a latent weakness:
   AniList's catalog episode count is often unknown, and an unknown total
   resurfaced a raw progress difference between two *completed* entries as a
   phantom disagreement — so the exception now treats **`status === 'completed'`
   as fully-watched whatever the count**. Verified inert on the real store:
   before/after diff of every row's `discrepancy` block = **0 changes** across
   25,382 rows, and the hydrated `personal` block = 0 changes (the total never
   feeds hydration).

**Verified on the real store (2026-07-21):** 25,382 catalog rows, 670 embedded
`my_list_status` → 669 statused entries extracted (1 empty-status artifact
dropped); catalog rewritten with 0 remaining; migration idempotent (a second run
is a no-op). A tier-drag write now touches only the ~100 KB personal file, not
the 39 MB catalog (verified by construction — `saveAnime`'s only remaining caller
is catalog ingest).

**Size:** medium, touched shipped data — a migration script
(`scripts/migrate-mal-personal.js`, modeled on `migrate-canonical.js`) run
against a stopped app before deploy, backed by the refuse-to-start guard.

**Unblocked elsewhere:** [DATA-LAYOUT.md](DATA-LAYOUT.md) organizes the store into
folders, with `personal/` holding *one file per `ProvenanceSource`*. That rule
yielded three of four until H1; `animes_mal_personal.json` is now the fourth, so
the layout work is no longer blocked on this.

## 3. The unifying fix — **shipped as D2, 2026-07-21**

**A capability descriptor per provider**, declaring:

- **role** — `catalog` and/or `personal` (AniList holds both; MAL holds both;
  SIMKL and local are personal-only)
- **auth kind** — `oauth` · `oauth+secret` · `anonymous` · `none`, **per role,
  not per provider** (as-built correction: AniList's catalog role is anonymous
  while its personal role is OAuth'd — see [D2](#d2--no-capability-descriptor-enablement-logic-duplicated--done-2026-07-21))
- **read capabilities** — catalog fields, personal list, full-list vs subset
  feed, crowd recommendations
- **write capabilities** — which of status/score/progress, and whether a status
  can be cleared

As built: [providerCapabilities.ts](../src/lib/providerCapabilities.ts) (the
declarative half, client-safe) + [providers.ts](../src/lib/providers.ts) (the
runtime half — connection status — server-only).

### Why this is not the registry PROVIDER-ABSTRACTION.md dropped

That document proposed abstracting **sync orchestration** behind a common
`fetchCatalog`/`fetchPersonalList` interface, and dropped it — correctly. MAL's
8-year seasonal crawl, SIMKL's `activities` + `date_from` delta, and AniList's
GraphQL batching are not the same operation; a shared interface would hide
genuinely different machinery behind a lowest-common-denominator shape. Its
verdict was: abstract only the **uniform** seams. F1 above reaffirms it.

This proposal abstracts strictly less: **identity, capability and status** — the
three things that *are* uniform across providers, and nothing that executes a
sync. It is the light interface that document recommended, scoped by what the
gaps actually demand rather than by what a fourth provider might.

### What it buys, per gap

- **A2** — `PRESENCE_ANCHORS` becomes a capability read, correct on any install
  rather than only a MAL one. *(Done — though **not** as "providers declaring a
  full list": that set is two providers and reports 430 of 671 titles as a
  presence split. It is the first full-list provider **in precedence**, i.e. one
  reference list. See [A2](#a2--presence_anchors--mal--done-2026-07-21).)*
- **D1** — a write against an undeclared dimension is refused explicitly instead
  of returning a bare success. *(Done — the patch is narrowed from the descriptor
  in `writePersonal`, so the writers no longer carry their own capability checks
  either; the outcome gained `unsupported`/`skipped`.)*
- **D2** — one source of truth; `hasWritableExternal` becomes a query over
  declared write capability rather than three hand-read auth files. *(Done — and
  the per-writer `isEnabled` went with it: enablement is now the single
  `isPersonalProviderEnabled`.)*
- **E1–E4** — one uniform card renders from the descriptor; capability
  differences appear as stated, disabled slots rather than as absence. Role
  splits the page the way the user thinks about it.

### What it does not touch

A1, B1, B2, C1 and F1 are **independent** and should not wait on it. A1 and C1
in particular are small, high-symptom, and blocked on nothing.

## 4. Suggested order

Nothing here is a committed plan — it is the ranking implied by the inventory.

1. ~~**A1**~~, ~~**G1**~~, ~~**C1**~~ — all **Done 2026-07-20**. The main list no
   longer looks empty to a non-MAL user. **B1** is now the top item.

   > A1 came in larger than ranked, and the lesson generalizes to the rest of
   > this document: the gaps are stated as "generic core, hardcoded feeder", but
   > the feeder is usually hardcoded *because the mapping it needs exists twice*.
   > Look for the duplicate before adding the branch. And check whether a
   > blocking asymmetry can be **removed** rather than conditionalized — A2 and
   > D1 both describe asymmetries that may not need to exist.
2. ~~**B1, then B2**~~ — both **Done 2026-07-21**. The keyless onboarding path is
   unblocked end to end: a title the AniList catalog crawl mints can now receive
   tags, staff, banner and relations from AniList, in bulk and on demand.
   **D2** is now the top item.

   > B1 confirmed the lesson A1 left: the query filter was the *stated* gap, but
   > the sweep would still have reached nothing, because its id list came from
   > the MAL catalog slice. When a core looks starved, check what feeds it names
   > before changing what it accepts. The same pass caught two more instances of
   > the identical mistake one layer down — a result filter on `m.idMal`, and a
   > relation edge that stored only a MAL id.
2b. ~~**B4**~~ — **Done 2026-07-21**, and it is the one that actually delivered
   the headline: the recommendation feed now works with no MAL account at all,
   on the AniList crowd source with AniList-hydrated candidates.

   > The lesson is about this document rather than the code. B3 named the
   > *visible* MAL-ness of the reco engine (its id keying) and correctly judged
   > it low-value — but having an entry there made the area look inventoried,
   > and the real blocker one layer up (an auth gate on the refresh route) was
   > never written down. **A ranked inventory can hide a gap by adjacency.**
   > Worth re-asking of the other sections: for each subsystem, does the keyless
   > path actually run end to end, or is it merely un-flagged?
3. ~~**D2**~~ — the capability descriptor. **Done 2026-07-21.** Two modules
   (declarative + client-safe, runtime + server-only); the per-writer `isEnabled`
   is gone. **A2 and D1 are now the top items**, one line each.

   > The lesson is the inverse of B1's. There the *stated* gap was too narrow;
   > here the stated **shape** was — §3 asked for one auth kind per provider,
   > which cannot describe AniList (anonymous catalog, OAuth'd list) and would
   > have baked E4's own bug into E4's fix. When a descriptor is written to
   > replace scattered derivations, check it against the provider that is least
   > like the others *before* the derivations are deleted.
4. ~~**A2, D1**~~ — both **Done 2026-07-21**. Presence detection works on any
   install (and works *at all* again — see below); a write SIMKL discards now
   says so. **E1–E4 is now the top item.**

   > Two lessons, and the second is the sharper one.
   >
   > **The declared data was right and the swap using it was not.** D2 left both
   > items as "a line each" and named the line. For A2 that line —
   > `PRESENCE_ANCHORS = fullListProviders()` — was measurably wrong (430 of 671
   > titles flagged), because `listCoverage: 'full'` answers *"does this
   > provider's read return the whole account?"* while presence detection asks
   > *"is this account the user's reference record?"*. A descriptor field can be
   > correct and still not be the predicate a consumer needs; **check the swap
   > against the store, not against the field name.**
   >
   > **Wiring A2 is what revealed presence detection had been dead since H1.**
   > The check needs the anchor to *have a state*, and H1 moved MAL's personal
   > data out of the catalog slice (one row per catalogued title) into one that
   > holds only statused titles — so from that day no install could report a
   > presence split, MAL-connected or not. Nothing surfaced it, including H1's own
   > verification, which diffed the `discrepancy` block over 25,382 rows and read
   > 0 changes. **A feature going quiet looks exactly like a feature with nothing
   > to say** — the two titles it should have flagged are 2 rows in 25,382, and a
   > row count that drops to zero reads as "no discrepancies today". Same shape as
   > B4's "a ranked inventory can hide a gap by adjacency", one level down: verify
   > that a path still *fires*, not only that its output did not change.
5. **E1–E4** — the connections rework, on top of D2. Largest visible payoff.
   Render from `PROVIDER_CAPABILITIES`; split the page by role (its `catalog` /
   `personal` keys are exactly E4's axis).
6. **F1** — independent; slot in whenever cron matters.
7. ~~**H1**~~ — the MAL catalog/personal split. **Done 2026-07-21.** The 39 MB
   rewrite per rating is gone, `MALAnime` is pure catalog, and
   [DATA-LAYOUT.md](DATA-LAYOUT.md)'s `personal/` folder is unblocked (its fourth
   file now exists). A per-provider-total fix rode along (see H1's writeup).
8. ~~**B3**~~ — **`Dropped` 2026-07-21.** Assessed and deferred indefinitely, as
   recommended; the MAL-keying is now stated in code at `RECS_QUERY` rather than
   left to be re-derived. Revisit only on the stated trigger.
