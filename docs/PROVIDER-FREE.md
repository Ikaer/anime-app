# Provider-free identity & the no-key path

> A **design + plan** document, not a progress tracker and not a changelog.
> It describes where the app is coupled to MyAnimeList, the target "plug the
> source you want" architecture, and a phased plan to get there. Update it when
> the *design* changes, not when work lands (that goes in git history).
>
> This supersedes nothing in [CLEANUP.md](CLEANUP.md); it expands on its item
> **§1.2** (`AnimeForDisplay extends MALAnime`) into a full feature.

Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`

> **Execution note (2026-07-13):** the remaining capstone — full retire of
> `extends MALAnime`, canonical id as the *outward* id, and re-keying the store
> off the MAL id — is now being landed as a coordinated cutover. The phased,
> checkpointed plan lives in **[PROVIDER-FREE-CUTOVER.md](PROVIDER-FREE-CUTOVER.md)**.
> The "deferred to a later sub-project" notes in Phases 2–3 below are what that
> cutover is now executing, not a future maybe.

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

These two goals are **aligned but distinct** — not the same design, and it's
worth being precise about why. It is tempting to claim "works with no MAL key"
forces "the record cannot *be* a MAL response," but that's false: **Jikan**
(see the candidate table) serves MAL's own data, in MAL's shape, keyed by MAL
id, with no OAuth app — so no-key onboarding is achievable while the record
stays a MAL response. Goal 1 alone does **not** require the reshape.

The reason we still pursue goal 2 (and pick **AniList** as the default) is goal
2 **on its own merits**: AniList is an independent catalog database, not a
re-serving of MAL. Jikan is the most MAL-*coupled* option on the board — a
proxy of the exact provider we're trying to stop baking in — so leaning on it
would satisfy the no-key goal while entrenching the coupling the second goal
exists to remove. We accept the wider reshape because a genuinely
provider-neutral core is the prize; no-key onboarding is its by-product, not
the other way around.

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
| **Jikan** (unofficial MAL) | **none** | ✅ (MAL data) | ✅ public MAL lists | ❌ | **MAL proxy** — re-serves MAL's own data by scraping, no independent catalog, no SLA. Zero-friction MAL data, but maximally MAL-coupled. **Optional import only, never the default** (see verdict below). Read-only, rate-limited. |
| **Kitsu** | none for reads | ✅ | ✅ | via OAuth | Public JSON:API, no key for reads. `kitsu` id already in the crosswalk. |
| **Shikimori** | none for reads | ✅ | ✅ public | via OAuth | MAL-like; public reads, OAuth for writes. |
| **AniDB** | client registration | ✅ (authoritative) | ✅ | limited | Strong catalog authority but restrictive/rate-limited API + registration. `anidb` id already in the crosswalk. |
| **SIMKL** | id + secret + OAuth | ❌ | ✅ | ratings | Wired today. Personal-state source. |
| **MAL (official)** | client id + OAuth | ✅ | ✅ | ✅ | Wired today. The friction being removed. |
| **Trakt / TMDB** | key | partial (TV/movie-centric) | ✅ (Trakt) | ✅ (Trakt) | Weak anime coverage; `tmdb`/`imdb` ids already in the crosswalk for cross-linking. |

**Jikan verdict: kept, but demoted — never the default.** It exposes MAL's
*catalog* and *public user lists* with no OAuth app, so on paper it's the
zero-setup way to get MAL data. But it is a **scraper/proxy of MyAnimeList**: no
catalog of its own, no service guarantee, and it breaks when MAL changes. For a
design whose thesis is "no single provider's shape baked in," making Jikan
load-bearing is self-defeating — it's MAL coupling with the OAuth filed off, the
opposite of goal 2. So its only legitimate role is an **optional import source**
for users who live on MAL and won't register the official OAuth app (MAL-id-
anchored catalog + public-MAL-list read). The default is **AniList** — an
independent database — precisely because it does *not* depend on MAL.

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
- **AniList is the default provider, not Jikan.** Jikan would be the smaller
  change (MAL-shaped, keeps the join key), but it is a MAL *proxy* and would
  entrench the very coupling goal 2 removes. AniList is chosen because it is an
  independent catalog — the no-key win must not come at the cost of re-baking MAL
  in. Jikan stays a possible opt-in import, never load-bearing.

---

## Phased plan

**Ordering principle: de-risk before you refactor.** The entire payoff (Phase 3)
is gated on an AniList capability that has *never been exercised in this
codebase*. That verification is nearly free, so it goes **first** — before the
wide, expensive reshape it would justify. Each phase below also states what it's
worth **on its own**, so the plan has an honest stopping point if Phase 0 comes
back negative.

### Phase 0 — Spike: does anonymous AniList actually work? `Done`

Cheap, ~an hour, no production code. The gate for everything downstream.

- Hit `graphql.anilist.co` **unauthenticated** and confirm two things the north
  star assumes but the codebase has never done (all current calls are
  `Media(idMal_in:)` enrichment):
  1. **Catalog browse** — `Page(media(season, seasonYear, sort: POPULARITY_DESC))`
     returns a browsable catalog with no auth.
  2. **Public personal list** — `MediaListCollection(userName: "...", type: ANIME)`
     returns a public profile's list with no auth, *with* per-item status/score/
     progress. Note the rate + query-complexity cost of both.
- **Decision this unblocks:** if both work, the zero-friction north star is
  reachable and Phases 1–3 proceed as written. **If the list read fails**, the
  no-key story degrades from *"enter your username"* to *"log in with AniList
  OAuth"* — still better than MAL, but a **materially different product** (no
  anonymous first-run). Phase 3 would then be re-scoped around AniList OAuth as
  the entry tier, and that's worth knowing *before* migrating 25 files partly in
  its name.
- **Standalone worth:** pure information. Produces a short findings note, no code
  to maintain.

**Findings (live-verified 2026-07-12, raw `curl` against `graphql.anilist.co`,
no auth header):**

1. **Catalog browse: confirmed.** `Page(media(season: SUMMER, seasonYear: 2026,
   sort: POPULARITY_DESC))` returns full results (id, `idMal`, title,
   popularity) with no auth.
2. **Public personal list: confirmed, with a caveat.** `MediaListCollection
   (userName: "...", type: ANIME)` returns per-entry `status`/`score`/
   `progress`/`media.idMal` with no auth — **but only for profiles whose list
   is public**, which is not universal. Observed three response shapes across
   test usernames: a real result (`Rue`, `test`, `testuser`, `AnimeFan`), an
   explicit `"Private User"` 404 for a private profile that exists (`josh`),
   and a plain `"User not found"` 404 for a username that doesn't exist. The
   app-facing contract is therefore: *username exists + public → works;
   username exists + private → distinguishable 404, show "this profile is
   private, log in with AniList instead"; username doesn't exist → distinguishable
   404, show "user not found"* — both failure modes are already
   cleanly separable from the error `message`, so the anonymous-username UX
   degrades gracefully rather than failing opaquely.
3. **Rate limit: confirmed as documented elsewhere in this codebase.** Response
   headers show `x-ratelimit-limit: 30` (`x-ratelimit-remaining` ticking down
   per call) — the same **degraded 30/min** ceiling already noted in CLAUDE.md
   for the existing AniList meta-sync, not the normal 90/min. No separate
   higher complexity cost observed on either query in this spike.

**Conclusion: gate passed.** Both north-star assumptions hold. Phases 1–3
proceed as written; the anonymous-username tier is real and does not need to
fall back to AniList-OAuth-only as the Phase 3 entry point. The one product
detail to carry into Phase 3: surface the private/not-found distinction in the
username-entry UI rather than a generic failure.

### Phase 1 — Persist the synthetic-id anchor registry `Done`

The concrete deliverable now. Additive; no consumer touches `AnimeRecord` yet.

- New store `animes_registry.json` = `Record<canonicalId, SourceIds>` where
  `canonicalId` is a freshly minted synthetic id (e.g. `a_<ulid>` or a monotonic
  counter — pick in Phase 1 kickoff). Holds **only** the provider-id crosswalk.
- Migration script (owner-run): allocate one canonical id per existing MAL id,
  seed each entry's crosswalk from today's `assembleCrosswalk` output.
- **Collision/uniqueness policy is a Phase 1 concern, not a Phase 2 one.** The
  migration can already mint two synthetic ids whose crosswalks both claim the
  same `anilist` id (MAL has split/duplicate entries that AniList merges, and
  vice-versa). The registry needs a uniqueness rule up front — at minimum,
  detect-and-report duplicate provider ids during migration; decide the merge/
  conflict resolution before any second provider seeds the registry.
- `store.ts` gains `getRegistry()` / `upsertCrosswalk()` / `resolveByMalId()` and
  `getAnimeForDisplay()` reads the registry instead of re-deriving the crosswalk.
- **The synthetic id is minted but NOT yet load-bearing:** `anime.id` stays the
  MAL id outward (URLs, `/anime/[id]`, API routes) so nothing downstream changes.
  The registry is the identity table, ready for Phase 2 to switch the join onto.
- **Standalone worth:** reversible, self-contained, and useful on its own — it
  makes the crosswalk durable and queryable even if Phases 2–3 never happen. A
  good standalone PR, and the honest **stop point** if Phase 0 comes back
  negative.

### Phase 2 — Introduce `AnimeRecord`, retire `extends MALAnime` `WIP`

CLEANUP.md §1.2 proper. The wide, mechanical one.

> **Landed:** `AnimeRecord`/`AnimeCatalog`/`AnimePersonal`/`AnimeSources` +
> `toAnimeRecord`; the `catalog`/`personal`/`sources` projection is **attached
> onto every merged record** (`MergedAnime` = pre-projection base;
> `AnimeForDisplay` = base + projection) so consumers migrate off raw MAL fields
> while the build stays green. **All ~182 catalog reads across 21 files migrated
> to `record.catalog.*`** (reco engine, main list + cards, detail/rating/tier/
> calculator/discrepancies). Personal reads **audited**: every `my_list_status`
> read is legitimately raw (the `getEffective*` seam source, MAL write paths,
> discrepancy comparison, the intentional "MAL status" display) — no flips
> needed. **Remaining (the coordinated capstone):** drop `extends MALAnime`
> (move the deliberately-raw readers onto `record.sources.mal.*`), flip
> `applyNarrowingFilters`/`animeYear`/`getPrimaryTitle` onto catalog, switch the
> **internal** join key to the canonical id, and de-bloat API payloads (the
> compact-mode field-strip in `api/anime/animes` no longer shrinks output since
> data also lives in the serialized `catalog` block).

- Define `AnimeRecord`; build the merge in `getAnimeForDisplay()` (catalog ←
  MAL-first; personal ← reuse the existing `getEffective*` helpers; raw slices →
  `sources`).
- Migrate the ~31 consumers off raw MAL fields onto `record.catalog.*` /
  `record.personal.*`, in small area-grouped PRs (API handlers → reco engine →
  pages → components), behind a temporary `AnimeForDisplay` compatibility alias.
- Switch the **internal** join key to the synthetic canonical id; keep MAL id
  reachable via `crosswalk.mal` for MAL API calls. **This is the internal join
  only** — the outward/URL id does NOT change here (see the contradiction below).
- **Outward-id contradiction — resolved by deferral, called out here so it isn't
  lost.** Phase 1 keeps MAL ids in URLs (`/anime/[id]`, API routes, the reco
  `w=` weights param). That works *only while every title has a MAL id*. The
  moment Phase 3 introduces an **AniList-only title, it has no MAL id and
  therefore no URL** under this scheme. So "make the id synthetic" is genuinely
  **two** projects: the internal join (this phase) and the *outward* id (Phase 3,
  its own sub-project touching every route, deep link, bookmark, and the reco
  URL param). Phase 2 deliberately does not attempt the outward switch; it just
  stops blocking it.
- **Standalone worth:** this is CLEANUP.md §1.2 on its own terms — it kills the
  `extends MALAnime` coupling and gives catalog fields the same precedence seam
  personal fields already have. Real code-health value **even if Phase 3 is
  dropped** — but note that if Phase 0 killed Phase 3, this becomes a large
  refactor with no *user-facing* payoff, so weigh it as cleanup, not feature.

### Phase 3 — No-key default: AniList-first, providers optional `WIP`

Where the north star becomes real. **Gated on Phase 0** — if the anonymous
list-read failed there, this phase is re-scoped around AniList OAuth as the
entry tier (the anonymous-username bullet below drops, everything else holds).

> **Landed:** the AniList **catalog crawler** (season/popularity, seeds the
> registry independently of MAL); the **per-field catalog precedence** seam now
> covers title/mean **and genres/studios** (P3a — MAL-first by default, so it
> only wins for AniList-only titles / a future flip; live-verified); the
> **anonymous AniList personal-list import by username** (P3b — the no-key
> path, lowest personal tier SIMKL > MAL > AniList, private/not-found UX from
> Phase 0). **Remaining:** promote the **outward** id to synthetic (the deferred
> half of Phase 2's join switch — every route/deep-link/reco-`w=` param, with
> MAL-id redirects; required before any AniList-only title is reachable);
> and flip the default catalog precedence to `['anilist','mal']`.

- Make catalog authority a per-field precedence list (`['mal','anilist']` →
  default `['anilist','mal']` once the crawler lands). No behavior change until
  a crawler exists to populate AniList catalog rows.
- Add an **AniList catalog crawler** (season / popularity browse) so AniList can
  seed the registry *independently of MAL* — the point at which the app first
  functions with no MAL key.
- Add the **anonymous AniList personal-list read by username** (no key) as the
  default personal source. *(Drops to AniList-OAuth-only if Phase 0 disproved
  anonymous list read.)*
- **Promote the outward id to synthetic (the deferred half of Phase 2's join
  switch).** This is the sub-project that lets an AniList-only title *have a URL*
  at all: migrate `/anime/[id]`, every API route param, deep links, and the reco
  `w=` weights param off the MAL id and onto the canonical id, with MAL-id URLs
  redirect-preserved for existing bookmarks. Required before any MAL-less title
  is reachable — it is not optional polish.

> Two once-coupled follow-ups now live as their own independent documents and
> are **out of scope for this initiative**: **AniList OAuth login** (private
> lists + write-back) → [ANILIST-OAUTH.md](ANILIST-OAUTH.md); a real
> **`Provider` abstraction** (sources as a configured list) →
> [PROVIDER-ABSTRACTION.md](PROVIDER-ABSTRACTION.md).

---

## Open questions

- **Synthetic id format** — ULID / uuid / monotonic counter? (Phase 1 kickoff.)
- ~~**AniList anonymous user-list**~~ — **Resolved in Phase 0 (2026-07-12):**
  `MediaListCollection(userName:)` works without auth for public profiles
  (30/min degraded rate limit, no extra complexity cost); private/nonexistent
  usernames return distinguishable 404s. See Phase 0 findings above.
- **Collision policy** — when SIMKL and AniList disagree on a crosswalk id for
  the same title, which wins? **Moved up to Phase 1** — the migration script can
  already mint duplicate provider-id claims, so the registry needs at least
  detect-and-report before a second provider seeds it.
- **Personal write-back with no MAL/SIMKL** — writes need OAuth on every
  provider (AniList included), so the anonymous tier is read-only for personal
  state. Is read-only-personal an acceptable first-run default, with **AniList
  OAuth login** as the natural upgrade for writes? (Product call.)
- **Jikan vs AniList-first** — **decided: AniList-first** (see Decisions locked).
  Jikan is a MAL proxy and would re-entrench MAL coupling, so it is not the
  default. Residual, low-priority: does Jikan ship *at all* as an optional
  MAL-import for MAL-native users who won't register the official OAuth, or not
  at all? (Defer past Phase 3.)
```