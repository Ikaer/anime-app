# Provider parity — the rules that came out of the gap inventory

> Closed inventory. Every gap (A1–H1) is resolved; this file keeps the **rule**
> each one established, because ~19 code comments cite these ids.
> The work itself is in git history.

## Thesis

The app runs on **local ids + local records**. AniList-unauthenticated is the
default catalog provider (what makes the app usable with no account); every
personal-list provider — MAL, SIMKL, AniList-OAuth, `local` — is an **opt-in
peer**. None is the spine; the local record is.

The cores were generalized to match (`computeDiscrepancy` takes a per-provider
map, `writePersonal` fans out over a writer registry, `toAnimeRecord` walks a
precedence list). The gaps were all in the **feeders, adapters and UI**, in one
of three shapes:

- **Generic core, hardcoded feeder** — the engine loops providers; its caller
  names three of them positionally.
- **A MAL-era assumption frozen into a constant** — true while MAL was the
  identity spine, false since the canonical-id cutover.
- **An asymmetry that is silent instead of declared** — a provider cannot do
  something, nothing says so, and the UI reports success.

## The rules, by gap id

### A. Generic core, hardcoded feeder

**A1 — one extractor table, two consumers.** The slice → status/score/progress
mapping must exist **once**. `buildProviderStates` (discrepancy) and hydration
both read the per-provider extractor table in
[providers/personalState.ts](../src/lib/providers/personalState.ts); hydration
narrows via `toAnimePersonal`. Adding a provider is one row, and it cannot be
added to one consumer only. **Participation is expressed once**: a provider is in
the map iff it appears in the resolved `personalPrecedence`.

Presence is `hasPersonalData` for every provider **except MAL**, which keeps a
stricter `!!status` — MAL's write path can seed a `{status:'', score:8}`
artifact that `hasPersonalData` would wrongly admit. Fully-watched
reconciliation uses `>=`, not `===`: watching past a total (borrowed from
another provider's episode count) is never itself a disagreement.

**A2 — the presence anchor is ONE provider, not a set.** `presenceAnchors(precedence)`
in [providers/capabilities.ts](../src/lib/providers/capabilities.ts) takes the
first `listCoverage: 'full'` provider **in the resolved personal precedence**.

`listCoverage: 'full'` is an **API** claim ("this read returns the whole
account"), *not* a claim that the account is the user's comprehensive record —
conflating the two and anchoring on every full-list provider measured **430 of
671** titles as a presence split. With one anchor: MAL where connected, else
AniList, else none.

The anchor rides on `ProviderPersonalState.anchor` rather than being an argument,
so `computeDiscrepancy` stays a pure function of what it is handed — the
discrepancies page re-runs it client-side over a filtered subset. **The anchor
gets a state even when it holds no entry** (`present: false`): a missing entry is
the whole point of a presence split, so it cannot be represented by omission.

### B. MAL as a mandatory join key

**B1 — enrichment is queryable by either id space.** The AniList batch query body
is built from one template with `idMal_in` *or* `id_in`. A batch is **homogeneous
by construction**: AniList applies a supplied-but-null argument as a real filter,
so a query carries exactly one id filter.

The larger half was the feeder: the sweep scanned the MAL catalog slice, so it
was structurally incapable of *naming* a title MAL doesn't know. It now scans the
**registry**. Same mistake existed twice more one layer down — a result filter on
`m.idMal`, and a relation edge that stored only a MAL id.

**B2 — single-title refresh takes the id space as a parameter.** MAL id when
there is one, AniList id otherwise, resolved from the **registry** (not the meta
slice, which is filled by the very sync the refresh triggers). Both MAL-less
outcomes stay distinguishable in the response.

**B3 — the reco engine stays MAL-keyed. Deliberate, `Dropped`.** MAL/AniList
crowd edges, suggestions and `cache/recommendations.json` all arrive as MAL ids,
so the join key is inherited from the data, not chosen. Stated in code at
`RECS_QUERY`. Revisit only if AniList-only titles become a large share of the
catalog (currently ~0 of 25,382).

**B4 — MAL *ids* ≠ MAL *auth*.** MAL ids come free off AniList's `idMal`, so
being MAL-id-keyed costs a keyless install almost nothing (that is B3). MAL
*authentication* gating the refresh route made the whole feed unreachable — that
was the real blocker, and B3's presence made the area look inventoried.

`performRecommendationsRefresh` takes `accessToken: string | null`; MAL sources
skip with a stated reason, the anonymous `anilistCrowd` source always runs, and a
`RecoRefreshSources` outcome map **declares** the degraded run. **Hydration is
the load-bearing half** — `computeFeed` drops candidates with no local record, so
a keyless run hydrates via `fetchAnilistCatalogByMalIds` (50/request) instead of
MAL's one-at-a-time detail fetch. Without it the route returns 200 and an empty
feed, which is worse than the 401 it replaced.

### C. Personal state displayed MAL-only

**C1 — list views read the effective seam.** `AnimeCardView`'s status badge and
`AnimeTable`'s "Moi" column go through `getEffective*` like every other surface.
Per-provider detail belongs on the `DiscrepancyBadge`.

**The optimistic overlay had to follow the read** — it patches `record.personal`,
not `sources.mal.my_list_status`, and is no longer guarded on a MAL slice
existing (which skipped it outright on exactly the SIMKL-only titles C1 fixes).
Normalization matches hydration: `status: ''` and `score: 0` become `undefined`.

### D. Silent asymmetries

**D1 — a discarded write is declared, not reported as success.** `writePersonal`
narrows the patch against `supportedDimensions(id)` **before either pass**, so a
writer never checks its own capabilities. The outcome carries
`unsupported: PersonalDimension[]` plus `skipped` when nothing applied.

`ok` stays **true** for a discard — it is a *partial* write, not a failure; the
outcomes map has three states (*applied* / *partial* / *failed*) and the UI must
distinguish them (muted note vs. red list). **Clearing a status is a different
case**: `status` is a dimension MAL/AniList do claim and clearing is a shape of it
they refuse, so they return an explicit `ok: false` with a reason.

**D2 — one capability descriptor, split on client-safety.**
[providers/capabilities.ts](../src/lib/providers/capabilities.ts) is declarative
(static, no fs, importable by React); [providers/registry.ts](../src/lib/providers/registry.ts)
is the runtime half (server-only, reads auth files) and the only place the two
compose.

**Roles are keys and each role carries its OWN auth kind.** One auth kind per
*provider* cannot describe AniList — catalog role `anonymous` (the whole keyless
promise), personal role `oauth+secret` — and would have frozen E4's own bug into
E4's fix.

Duplication went by **removal, not indirection**: writers carry no `isEnabled`;
the registry filters on the single `isPersonalProviderEnabled`, which
`hasWritableExternal()` and `canClearStatus()` are also queries over. Descriptors
are a `Record<ProvenanceSource, …>`, so a writer with no descriptor row is a
compile error.

### E. Connections UI

**E1–E4 — a card is a (provider, role) pair, not a provider.**
[connections.tsx](../src/pages/connections.tsx) is two role groups (Catalogue /
Mes listes) mapping `providersWithRole(role)` over one
[ProviderCard](../src/components/anime/connections/ProviderCard.tsx). MAL and
AniList render twice, and **the auth kind is read from the role** — AniList's
catalog card says "aucun compte requis" while its list card asks for OAuth. A
dual-role provider shows its account control in the personal group only.

**The missing piece was a uniform status *read*, not a uniform card.** Three
bespoke auth endpoints answered three payload shapes, which is why E2's three
badge components were *stateful* duplicates over an already-shared presenter —
they duplicated shape-flattening, not rendering. Hence
[providers/status.ts](../src/lib/providers/status.ts) + `GET /api/anime/providers`
+ [useProviderStatuses](../src/hooks/useProviderStatuses.ts) as its single client
reader. The per-provider `auth` endpoints keep owning the OAuth *flows*, which
genuinely differ.

`connected` is token **presence** (same predicate as `isPersonalProviderEnabled`,
so a badge cannot disagree with the write path); `tokenValid` is separate, and
`connected && !tokenValid` renders amber "session expirée" rather than "not
connected". `local` gets a card always and a badge **only while enabled**.

**Actions are NOT abstracted** — each provider's sync stays its own block in
`CatalogRoleActions` / `PersonalRoleActions`. Only the card is uniform.

### F. Orchestration

**F1 — no provider gates the scheduled run.** [cron-sync.ts](../src/pages/api/anime/cron-sync.ts)
is five isolated, non-fatal steps, each guarding itself with
`isPersonalProviderEnabled(id)`. A missing MAL token used to 400 the whole
handler, so a SIMKL-only, AniList-only or keyless install got nothing — including
the reco refresh B4 had already made MAL-optional.

Each step returns a `CronStepOutcome` (`skipped: true` = not applicable;
`ok: false` = should have run and didn't) and **the handler answers 200 even when
a step failed** — a non-2xx tells the NAS cron job "nothing ran".

The AniList metadata sync is **ungated** (its role's auth kind is `anonymous`) and
runs last, fire-and-forget — hence `isAnilistMetaSyncRunning()`, so a
non-awaited step can still report "already running" honestly. **Order is
load-bearing**: data pulls first, so the reco refresh ranks over what just landed
(measured 4 seeds vs 274 on the same store).

MAL's list sync is deliberately not a sixth call — big-sync's seasonal payload
carries `my_list_status` inline and `upsertAnime` splits it into the personal
slice on ingest (H1).

### G. Documentation drift

**G1 — CLAUDE.md is the map future work is planned against**, so a real feature
reading as missing there is a defect. Keep it current in the same commit.

### H. Catalog / personal separation

**H1 — MAL's personal state is its own slice.** `MALPersonalEntry` (a type alias
of the wire shape `MALListStatus`, verbatim field names) lives in
`personal/mal.json`; `MALAnime` is pure catalog. **Split on ingest**: `upsertAnime`
strips `my_list_status` off every incoming MAL record and routes it to the
personal slice, clearing the entry when a fetch returns the title without a
status.

Why it mattered: a rating write used to serialize the entire 39 MB catalog (and
invalidate every assembled row) to record one score. It did **not** remove the
presence carve-out — split-on-ingest can still seed a `{status: ''}` entry, so
`!!status` stays.

A **per-provider-total** fix rode along: each provider's fully-watched check uses
its OWN catalog's episode count, and `status === 'completed'` counts as
fully-watched whatever the count (AniList's episode count is often unknown).

Guarded by a **refuse-to-start check** — lazy, on the first catalog read, not at
import time (module scope also runs during `next build`). Finding an embedded
`my_list_status` throws with the name of the migration script.

## What deliberately stayed un-abstracted

Sync **orchestration**. MAL's 8-year seasonal crawl, SIMKL's `activities` +
`date_from` delta, and AniList's GraphQL batching are not the same operation —
see [PROVIDER-ABSTRACTION.md](PROVIDER-ABSTRACTION.md). What is uniform, and
therefore shared, is **identity, capability and status**.

## Lessons worth carrying to the next inventory

- **Look for the duplicate before adding the branch.** A feeder is usually
  hardcoded because the mapping it needs exists twice (A1).
- **Check what feeds a starved core before changing what it accepts** (B1).
- **Ask what refuses the request before the code you are looking at runs.** Three
  of the last four items were larger than their evidence line, always in the same
  direction: the stated gap was a missing capability, the real gap was a *guard*
  in front of a capability that already existed (B4, F1, A2).
- **A ranked inventory can hide a gap by adjacency** — B3 made the reco engine
  look inventoried while B4 went unwritten.
- **Verify that a path still fires, not only that its output did not change.**
  Presence detection was dead from H1 until A2, and a row count dropping to zero
  reads exactly like "no discrepancies today".
