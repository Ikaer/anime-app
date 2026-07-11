# Provider-free identity & the no-key path

> A **design + plan** document, not a progress tracker and not a changelog.
> It describes where the app is coupled to MyAnimeList, the target "plug the
> source you want" architecture, and a phased plan to get there. Update it when
> the *design* changes, not when work lands (that goes in git history).
>
> This supersedes nothing in [CLEANUP.md](CLEANUP.md); it expands on its item
> **§1.2** (`AnimeForDisplay extends MALAnime`) into a full feature.

Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`

---

## North star

Two goals, ranked:

1. **Zero-friction, no-API-key onboarding.** The single biggest adoption barrier
   today is that the app is unusable without registering a MyAnimeList OAuth app
   (`MAL_CLIENT_ID`, a redirect URI, the dev console). That is "technical" and it
   turns people away. The app should work **out of the box with no key and no
   account setup**, and let a user *optionally* plug in richer providers.
2. **Provider-free core.** No single provider's API shape should be baked into
   the local record. Sources are interchangeable, absent-tolerant refill pipes
   over a provider-neutral record — exactly the "local cache authority" model
   already asserted in CLAUDE.md but not yet true in the types.

These two goals point at the same design. You can't have (1) without (2),
because "works with no MAL key" means "the record cannot *be* a MAL response."

---

## Feasibility: which provider can be the default?

| Provider | Setup cost | Catalog browse | Crowd recos | Tags/staff | Personal list | Writes |
|---|---|---|---|---|---|---|
| **AniList** | **none** (public GraphQL) | ✅ `Page(media(season,sort))` | ✅ (already used) | ✅ (already used) | ⚠️ read-only by username, **needs verification** | ❌ needs OAuth |
| **MAL** | client id + OAuth redirect | ✅ (used today) | ✅ (used today) | ❌ | ✅ (OAuth) | ✅ (OAuth) |
| **SIMKL** | client id + secret + OAuth | ❌ | ❌ | ❌ | ✅ (OAuth) | ✅ ratings only |

**Conclusion: AniList is the only source that needs no setup, and it already
covers catalog + crowd recos + tags/staff.** It is the natural **default
authoritative provider**. MAL and SIMKL become **optional plug-ins** a user
enables when they want MAL/SIMKL personal sync or write-back.

### AniList access has two tiers — use both

AniList offers *two* ways in, and the design should accommodate both rather than
picking one:

1. **Anonymous path (zero friction, the default).** The public API is expected
   to expose a user's list via `MediaListCollection(userName: "...", type:
   ANIME)` **iff that profile is public**. If so, out-of-the-box onboarding is
   just *"enter your AniList username"* — no OAuth, no key. This has **never been
   exercised in this codebase** (all current AniList calls are `Media(idMal_in:)`
   catalog enrichment), so it stays an **assumption to investigate** before
   Phase 3 hardens — captured in Open Questions, not to be spiked now.

2. **AniList OAuth login (optional, richer).** AniList also has its own OAuth —
   a login tier *above* the anonymous path. It is what unlocks the two things
   anonymous access can't give: **private-profile lists** and **write-back**
   (rating/status push to AniList). So the provider tiers become:
   *anonymous AniList (read public list, no setup)* → *AniList login (private
   list + writes)* → *MAL / SIMKL (opt-in, their own OAuth)*. Crucially, an
   AniList OAuth app is still **less friction than MAL's** for the end user in
   the common case, because the anonymous tier already covers first-run.

---

## Candidate providers

Beyond the three wired in today, ranked by fit with the **no-key** goal. The
crosswalk (`SourceIds`) is already open-ended, so adding any of these to
*identity* costs nothing; adding one as a *data source* is a new sync module.

| Provider | Key needed | Catalog | Personal list | Writes | Notes |
|---|---|---|---|---|---|
| **AniList** | none (OAuth for writes/private) | ✅ | ✅ public by username | via OAuth | The default. Already wired for enrichment. |
| **Jikan** (unofficial MAL) | **none** | ✅ (MAL data) | ✅ public MAL lists | ❌ | **MAL catalog + public MAL list with no OAuth app.** The zero-friction way to get MAL data — the exact barrier the owner wants gone. Read-only, rate-limited. |
| **Kitsu** | none for reads | ✅ | ✅ | via OAuth | Public JSON:API, no key for reads. `kitsu` id already in the crosswalk. |
| **Shikimori** | none for reads | ✅ | ✅ public | via OAuth | MAL-like; public reads, OAuth for writes. |
| **AniDB** | client registration | ✅ (authoritative) | ✅ | limited | Strong catalog authority but restrictive/rate-limited API + registration. `anidb` id already in the crosswalk. |
| **SIMKL** | id + secret + OAuth | ❌ | ✅ | ratings | Wired today. Personal-state source. |
| **MAL (official)** | client id + OAuth | ✅ | ✅ | ✅ | Wired today. The friction being removed. |
| **Trakt / TMDB** | key | partial (TV/movie-centric) | ✅ (Trakt) | ✅ (Trakt) | Weak anime coverage; `tmdb`/`imdb` ids already in the crosswalk for cross-linking. |

**Standout for the no-key goal: Jikan.** It exposes MAL's *catalog* and *public
user lists* with no OAuth app at all — so "MAL data, zero setup" is achievable
without ever touching the official MAL OAuth flow. It can't write and can't read
private lists, but as a first-run catalog + public-list source it directly
attacks the friction the owner called out. Worth weighing against AniList-first,
or alongside it (Jikan for MAL-id-anchored catalog, AniList for tags/recos).

---

## Where MAL is baked in today

Two distinct problems, deliberately kept apart:

**A — Identity is implicit.** The join key everywhere is the MAL id. A crosswalk
of provider ids (`SourceIds`: mal, anilist, simkl, anidb, kitsu…) is *computed*
at display time by `assembleCrosswalk` in [store.ts](../src/lib/store.ts) and
thrown away. There is **no persisted anchor** that says "internal title #N is
{mal:1, anilist:5114}". That anchor is the foundation everything else needs.

**B — The record shape is a MAL response.** `AnimeForDisplay extends MALAnime`
([models/anime/index.ts:157](../src/models/anime/index.ts)). Catalog fields
(`mean`, `genres`, `studios`, `main_picture`, `start_season`) and personal
fields (`my_list_status`) are MAL's JSON; SIMKL/AniList are bolted on as optional
side-objects. **Blast radius: ~153 reads of MAL-shaped fields across 31 files.**

Personal-field precedence is *already* provider-neutral behind the
`getEffectiveStatus` / `getEffectiveScore` / `getEffectiveProgress` seam in
[animeUtils.ts](../src/lib/animeUtils.ts) (SIMKL-first, MAL fallback). Catalog
fields have no such seam yet — they read MAL raw.

### How hardcoded is the provider set? (codebase review)

Reviewed the tree for a provider abstraction. **There is essentially none** —
the exact three providers are hand-coded, name by name, across ~53 files (907
occurrences of `mal`/`simkl`/`anilist`). Adding a 4th provider today means
editing all of the following by hand:

- **Types** — `RecoSource` is a closed union with provider-specific members
  (`crowd`, `anilistCrowd`, `suggestions`…) in [models/anime](../src/models/anime/index.ts);
  `DEFAULT_WEIGHTS` in [recoWeights.ts](../src/lib/recoWeights.ts) enumerates them,
  and they're persisted in the URL weights param, so the set isn't even free to
  change without a migration.
- **Sync modules** — one bespoke file per provider (`mal.ts`/`malSync.ts`/`malWrite.ts`,
  `simkl*.ts`, `anilistSync.ts`); no shared "provider" interface they implement.
- **Hooks / UI** — `useConnections` returns a fixed `{ mal, simkl, anilist }`;
  components are provider-named (`SimklSection`, `SimklConnectionBadge`,
  `SimklDiscrepancyBadge`), not driven off a provider list.
- **Storage & config** — one hardcoded filename per provider in
  [store.ts](../src/lib/store.ts); `LogSource` channels in
  [connectionLog.ts](../src/lib/connectionLog.ts); env vars in `.env.example`.

**The one thing that IS abstracted:** `SourceIds` is open-ended (`[key: string]:
number | string`), so the *crosswalk / identity* layer already accepts arbitrary
providers for free. That is exactly why Phase 1 (the anchor registry) is cheap
and the rest is not.

**Implication for the plan — a design choice to make, not necessarily now:**
whether to introduce a real `Provider` abstraction (a common interface: `id`,
`fetchCatalog?`, `fetchPersonalList?`, `fetchRecos?`, `write?`, capability flags)
so providers become a registered list instead of hand-wired names. It's the
difference between "plug the source you want" as a *slogan* and as an actual
extension point. **Not required for Phases 1–2**, but it's the thing that makes
Phase 3's "boots on AniList alone / add Jikan/Kitsu" real rather than another
round of copy-paste. Flagged here; decide when Phase 3 is scoped.

---

## Target model

```
AnimeRecord {
  id:        string                 // SYNTHETIC canonical id — tied to no provider
  crosswalk: SourceIds              // { mal, anilist, simkl, ... } — PERSISTED, authoritative
  catalog:   { title, picture, mean, genres, studios, season, ... }  // source-merged
  personal:  { status, score, progress }                             // source-merged (SIMKL/MAL)
  sources:   { mal?, simkl?, anilist? }   // raw per-provider slices, verbatim
}
```

- **The anchor file you asked for = the persisted crosswalk**, promoted from a
  throwaway computed field to a first-class store (`animes_registry.json`),
  keyed by the synthetic id.
- **`catalog` / `personal` are merge projections** with configurable per-field
  precedence. Personal already has its seam; catalog gets one. Default catalog
  authority stays MAL today, flips to AniList when the AniList catalog crawler
  exists.
- **`sources` keeps every raw slice** so no provider data is lost in the merge
  and any provider can be re-projected.

---

## Decisions locked

- **New document** (this file), not an edit to CLEANUP.md. ✔
- **Synthetic internal canonical id**, independent of every provider — chosen
  over "reuse MAL id" precisely because the no-key goal means MAL may be absent.
- **Data migration is acceptable.** The owner will re-sync / run a migration
  script; no dual-read fallback is required (same coordinated-cutover approach as
  CLEANUP.md §3.0).

---

## Phased plan

### Phase 1 — Persist the synthetic-id anchor registry `Todo`

The concrete deliverable now. Additive; no consumer touches `AnimeRecord` yet.

- New store `animes_registry.json` = `Record<canonicalId, SourceIds>` where
  `canonicalId` is a freshly minted synthetic id (e.g. `a_<ulid>` or a monotonic
  counter — pick in Phase 1 kickoff). Holds **only** the provider-id crosswalk.
- Migration script (owner-run): allocate one canonical id per existing MAL id,
  seed each entry's crosswalk from today's `assembleCrosswalk` output.
- `store.ts` gains `getRegistry()` / `upsertCrosswalk()` / `resolveByMalId()` and
  `getAnimeForDisplay()` reads the registry instead of re-deriving the crosswalk.
- **The synthetic id is minted but NOT yet load-bearing:** `anime.id` stays the
  MAL id outward (URLs, `/anime/[id]`, API routes) so nothing downstream changes.
  The registry is the identity table, ready for Phase 2 to switch the join onto.
- Reversible, self-contained — a good standalone PR.

### Phase 2 — Introduce `AnimeRecord`, retire `extends MALAnime` `Todo`

CLEANUP.md §1.2 proper. The wide, mechanical one.

- Define `AnimeRecord`; build the merge in `getAnimeForDisplay()` (catalog ←
  MAL-first; personal ← reuse the existing `getEffective*` helpers; raw slices →
  `sources`).
- Migrate the ~31 consumers off raw MAL fields onto `record.catalog.*` /
  `record.personal.*`, in small area-grouped PRs (API handlers → reco engine →
  pages → components), behind a temporary `AnimeForDisplay` compatibility alias.
- Switch the internal join key to the synthetic canonical id; keep MAL id
  reachable via `crosswalk.mal` for MAL API calls.

### Phase 3 — No-key default: AniList-first, providers optional `Todo`

Where the north star becomes real. Gated on the AniList-user-list verification.

- Make catalog authority a per-field precedence list (`['mal','anilist']` →
  default `['anilist','mal']` once the crawler lands). No behavior change until
  a crawler exists to populate AniList catalog rows.
- Add an **AniList catalog crawler** (season / popularity browse) so AniList can
  seed the registry *independently of MAL* — the point at which the app first
  functions with no MAL key.
- Add the **anonymous AniList personal-list read by username** (no key) as the
  default personal source.
- Add optional **AniList OAuth login** as the tier above it — unlocks private
  lists + AniList write-back — then MAL/SIMKL as further opt-in providers.
- Provider enablement becomes config, not code: the app boots on AniList alone.

---

## Open questions

- **Synthetic id format** — ULID / uuid / monotonic counter? (Phase 1 kickoff.)
- **AniList anonymous user-list** — does `MediaListCollection(userName:)` work
  without auth for public profiles, and what's the rate/complexity cost? (Verify
  before Phase 3.)
- **Collision policy** — when SIMKL and AniList disagree on a crosswalk id for
  the same title, which wins? (Registry needs a conflict rule by Phase 2.)
- **Personal write-back with no MAL/SIMKL** — writes need OAuth on every
  provider (AniList included), so the anonymous tier is read-only for personal
  state. Is read-only-personal an acceptable first-run default, with **AniList
  OAuth login** as the natural upgrade for writes? (Product call.)
- **AniList OAuth scope** — what does registering an AniList OAuth app cost the
  *deployer* (redirect URI, client id), and is it low enough that shipping it
  enabled-by-default makes sense, or does it stay a self-host opt-in? (Phase 3.)
- **Jikan vs AniList-first** — Jikan gives MAL catalog + public MAL list with no
  key. Is the no-key default AniList, Jikan, or both (Jikan for MAL-anchored
  catalog, AniList for tags/recos)? (Phase 3 scoping.)
- **A real `Provider` abstraction?** — introduce a common provider interface +
  registry so sources are a configured list, not hand-wired names? Not needed for
  Phases 1–2; it's what makes Phase 3's "add Jikan/Kitsu" not-a-copy-paste.
  (Decide at Phase 3.)
```