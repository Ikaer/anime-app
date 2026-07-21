# Provider parity — the gap inventory

> A **gap inventory + ranked fixes** document.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `WIP`** — A1, G1, C1 `Done` (2026-07-20); H1 `Done` (2026-07-21). Rest `Todo`.
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

1. ~~**A1**~~, ~~**G1**~~, ~~**C1**~~ — all **Done 2026-07-20**. The main list no
   longer looks empty to a non-MAL user. **B1** is now the top item.

   > A1 came in larger than ranked, and the lesson generalizes to the rest of
   > this document: the gaps are stated as "generic core, hardcoded feeder", but
   > the feeder is usually hardcoded *because the mapping it needs exists twice*.
   > Look for the duplicate before adding the branch. And check whether a
   > blocking asymmetry can be **removed** rather than conditionalized — A2 and
   > D1 both describe asymmetries that may not need to exist.
2. **B1, then B2** — unblocks the keyless onboarding path end to end. The
   highest-value fix, and the one most aligned with the provider-free direction.
3. **D2** — the capability descriptor, once the standalone defects are cleared.
4. **A2, D1** — fall out of D2 cheaply.
5. **E1–E4** — the connections rework, on top of D2. Largest visible payoff.
6. **F1** — independent; slot in whenever cron matters.
7. ~~**H1**~~ — the MAL catalog/personal split. **Done 2026-07-21.** The 39 MB
   rewrite per rating is gone, `MALAnime` is pure catalog, and
   [DATA-LAYOUT.md](DATA-LAYOUT.md)'s `personal/` folder is unblocked (its fourth
   file now exists). A per-provider-total fix rode along (see H1's writeup).
8. **B3** — recommend deferring indefinitely. Documented as deliberate.
