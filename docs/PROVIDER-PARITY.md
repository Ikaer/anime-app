# Provider parity — the gap inventory

> A **gap inventory + ranked fixes** document.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `Todo`** — inventory complete, no fix started.
> Companion to [PROVIDER-FREE.md](PROVIDER-FREE.md) (which delivered the shift
> this document measures against) and [PROVIDER-ABSTRACTION.md](PROVIDER-ABSTRACTION.md)
> (whose dropped registry is **not** what this proposes — see [§3](#3-the-unifying-fix)).

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

#### A1 — `buildProviderStates` omits AniList

**Evidence:** [store.ts:532](../src/lib/store.ts) —
`buildProviderStates(mal, simkl, local, personalPrecedence)`, three positional
provider params, no `anilist` branch. `anilistPersonal` is in scope and passed
to `toAnimeRecord` at [store.ts:607](../src/lib/store.ts), one line after the
`computeDiscrepancy` call that ignores it.

**Symptom:** AniList never appears on `/discrepancies`, never triggers the
`disc` filter, never shows a `DiscrepancyBadge`. A user whose AniList list
disagrees with MAL is told the two agree.

**Fix:** build an `anilist` state from `anilistPersonal`. Both consumers already
handle it. Note the entry is keyed on the AniList media id and carries no
episode total of its own — same situation as `local`, which resolves it by
borrowing the catalog count.

**Size:** small. One function, no consumer changes.

#### A2 — `PRESENCE_ANCHORS = ['mal']`

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

### B. MAL as a mandatory join key

These block the provider-free promise directly: the no-account path creates
records that the rest of the system cannot process.

#### B1 — AniList enrichment is queryable only by MAL id

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

#### B2 — Single-title refresh derives every source from the MAL id

**Evidence:** [refresh.ts:55-67](../src/pages/api/anime/animes/[id]/refresh.ts) —
`getMalIdForCanonical(canonicalId)` gates the MAL refill *and*
`refreshAnilistMetaForIds([malId])`, while `anilistId` is read at line 59 and
passed only to the cast fetch.

**Symptom:** the `RefreshButton` on a MAL-less title is a no-op for AniList
metadata, even though the AniList id is resolved three lines above.

**Fix:** falls out of B1 — once meta refresh accepts an AniList id, route it
through. Independently correct even before B1's batch path.

**Size:** small, once B1 exists.

#### B3 — The recommendation engine is MAL-keyed

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

### C. Personal state still displayed MAL-only

#### C1 — List views bypass the effective-value seam

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

**Size:** small to medium — small for the read, medium with the optimistic path.

### D. Silent asymmetries

The category that motivates the capability descriptor: in each case a provider
cannot do something, and the absence is invisible rather than stated.

#### D1 — SIMKL reports success for writes it discards

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

#### D2 — No capability descriptor; enablement logic duplicated

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

#### G1 — CLAUDE.md understates the AniList integration

**Evidence:** CLAUDE.md's AniList OAuth section lists *"the authenticated
private-list read is not implemented yet"* as an open item.
[anilistPersonalSync.ts:228-246](../src/lib/anilistPersonalSync.ts) implements
exactly that: with no username and a live token it imports the viewer's own list,
private entries included, and passes the bearer token even on by-name reads.

**Symptom:** the doc understates capability, which matters because CLAUDE.md is
the map future work is planned against — a real feature reads as missing.

**Size:** trivial. Worth doing in the same pass as any AniList fix.

## 3. The unifying fix

**A capability descriptor per provider**, declaring:

- **role** — `catalog` and/or `personal` (AniList holds both; MAL holds both;
  SIMKL and local are personal-only)
- **auth kind** — `oauth` · `oauth+secret` · `anonymous` · `none`
- **read capabilities** — catalog fields, personal list, full-list vs subset
  feed, crowd recommendations
- **write capabilities** — which of status/score/progress, and whether a status
  can be cleared

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

- **A2** — `PRESENCE_ANCHORS` becomes "providers declaring a full list",
  correct on any install rather than only a MAL one.
- **D1** — a write against an undeclared dimension is refused explicitly instead
  of returning a bare success.
- **D2** — one source of truth; `hasWritableExternal` becomes a query over
  declared write capability rather than three hand-read auth files.
- **E1–E4** — one uniform card renders from the descriptor; capability
  differences appear as stated, disabled slots rather than as absence. Role
  splits the page the way the user thinks about it.

### What it does not touch

A1, B1, B2, C1 and F1 are **independent** and should not wait on it. A1 and C1
in particular are small, high-symptom, and blocked on nothing.

## 4. Suggested order

Nothing here is a committed plan — it is the ranking implied by the inventory.

1. **A1, C1** — small, self-contained, immediately visible. C1 is the one that
   makes the app look empty to a non-MAL user; A1 is the exemplar gap.
2. **G1** — trivial, do it alongside 1.
3. **B1, then B2** — unblocks the keyless onboarding path end to end. The
   highest-value fix, and the one most aligned with the provider-free direction.
4. **D2** — the capability descriptor, once the standalone defects are cleared.
5. **A2, D1** — fall out of D2 cheaply.
6. **E1–E4** — the connections rework, on top of D2. Largest visible payoff.
7. **F1** — independent; slot in whenever cron matters.
8. **B3** — recommend deferring indefinitely. Documented as deliberate.
