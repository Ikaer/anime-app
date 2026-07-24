# Provider-free identity & the no-key path

> The **north star** and the provider landscape behind it. Delivered — the
> execution is [PROVIDER-FREE-CUTOVER.md](PROVIDER-FREE-CUTOVER.md), the
> follow-up gap closure is [PROVIDER-PARITY.md](PROVIDER-PARITY.md). Kept because
> code comments cite its phase labels (Phase 3, P3a, P3b) and because the
> provider comparison is still the answer to "why AniList?".

## Phase labels code comments cite

| Label | What it delivered |
|---|---|
| **Phase 1** | The persisted synthetic-id anchor registry (`registry.json`). |
| **Phase 2** | `AnimeRecord`; `extends MALAnime` retired; the internal join key switched to canonical. |
| **Phase 3** | The no-key default — AniList catalog crawler + per-field catalog precedence + the outward canonical id. |
| **P3a** | Catalog precedence widened to cover genres/studios, not just title/mean. |
| **P3b** | The AniList personal-list import (originally anonymous by username — see the note below). |

The execution detail is [PROVIDER-FREE-CUTOVER.md](PROVIDER-FREE-CUTOVER.md)
(Phases A–E), which pulled forward the deferred halves of Phases 2 and 3.

## North star

Two goals, ranked:

1. **Zero-friction, no-API-key onboarding.** The app must work out of the box
   with no key and no account setup, and let a user *optionally* plug in richer
   providers. Requiring a MyAnimeList OAuth app registration was the single
   biggest adoption barrier.
2. **Provider-free core.** No single provider's API shape baked into the local
   record. Sources are interchangeable, absent-tolerant refill pipes over a
   provider-neutral record.

**These are aligned but distinct, and the difference is load-bearing.** It is
tempting to claim "works with no MAL key" forces "the record cannot *be* a MAL
response" — that is false. **Jikan** serves MAL's own data, in MAL's shape, keyed
by MAL id, with no OAuth app, so goal 1 alone does not require the reshape.

Goal 2 is pursued **on its own merits**: AniList is an independent catalog
database, not a re-serving of MAL. Leaning on Jikan would satisfy the no-key goal
while entrenching the exact coupling goal 2 exists to remove. A genuinely
provider-neutral core is the prize; no-key onboarding is its by-product, not the
other way around.

## Which provider can be the default?

| Provider | Setup cost | Catalog browse | Crowd recos | Tags/staff | Personal list | Writes |
|---|---|---|---|---|---|---|
| **AniList** | **none** (public GraphQL) | ✅ | ✅ | ✅ | ✅ (OAuth) | ✅ (OAuth) |
| **MAL** | client id + OAuth redirect | ✅ | ✅ | ❌ | ✅ (OAuth) | ✅ (OAuth) |
| **SIMKL** | client id + secret + OAuth | ❌ | ❌ | ❌ | ✅ (OAuth) | ✅ ratings only |

**AniList is the only source that needs no setup, and it already covers catalog +
crowd recos + tags/staff.** It is the default catalog provider; MAL and SIMKL are
opt-in plug-ins for their own personal sync and write-back.

**AniList's anonymous catalog tier is verified**, not assumed:
`Page(media(season, seasonYear, sort: POPULARITY_DESC))` returns a full browsable
catalog with no auth header, at the degraded **30 req/min** ceiling
(`x-ratelimit-limit: 30`) rather than the documented 90.

> **Note on the anonymous personal-list tier.** `MediaListCollection(userName:)`
> does work unauthenticated for *public* profiles, and shipped that way (P3b).
> It was later **removed** — post-OAuth it read a list the user could not write
> back to, and it was the only way the AniList personal slice could be filled by
> someone with no AniList connection. Removing it closed the discrepancy
> actionability gate for free (PROVIDER-PARITY.md A1). The AniList personal import
> is **authenticated-only** today.

## Candidate providers

Beyond the three wired in. The crosswalk (`SourceIds`) is open-ended, so adding
any of these to *identity* costs nothing; adding one as a *data source* is a new
sync module.

| Provider | Key needed | Catalog | Personal list | Writes | Notes |
|---|---|---|---|---|---|
| **AniList** | none (OAuth for writes/private) | ✅ | ✅ | via OAuth | The default. |
| **Jikan** (unofficial MAL) | **none** | ✅ (MAL data) | ✅ public MAL lists | ❌ | **MAL proxy** — scrapes, no independent catalog, no SLA. Optional import only, never the default. |
| **Kitsu** | none for reads | ✅ | ✅ | via OAuth | Public JSON:API. `kitsu` id already in the crosswalk. |
| **Shikimori** | none for reads | ✅ | ✅ public | via OAuth | MAL-like; public reads, OAuth for writes. |
| **AniDB** | client registration | ✅ (authoritative) | ✅ | limited | Strong catalog authority, restrictive API + registration. |
| **Trakt / TMDB** | key | partial (TV/movie-centric) | ✅ (Trakt) | ✅ (Trakt) | Weak anime coverage; ids kept for cross-linking. |

**Jikan verdict: kept, but demoted — never the default.** For a design whose
thesis is "no single provider's shape baked in", making a MAL proxy load-bearing
is self-defeating: it is MAL coupling with the OAuth filed off. Its only
legitimate role is an optional import for users who live on MAL and won't
register the official OAuth app.

## Decisions locked

- **A synthetic internal canonical id**, independent of every provider — chosen
  over "reuse the MAL id" precisely because the no-key goal means MAL may be
  absent. Format `a_<n>` (monotonic counter), safe **because** the registry is
  durable and resolve-before-mint is enforced on every write path.
- **Data migration is acceptable.** Coordinated cutover, no dual-read fallback.
- **AniList is the default provider, not Jikan** (see above).

## Still open

- **Catalog precedence still defaults MAL-first** (`['mal','anilist']`). Flipping
  it to `['anilist','mal']` is the last piece of the north star and is a
  behaviour change on any MAL-anchored store, so it wants measuring first.
- **Collision policy** — when two providers disagree on a crosswalk id for the
  same title, the resolver detects and reports rather than merging. What a *merge*
  should do is undecided.
- **Personal write-back needs OAuth on every provider**, so the anonymous tier is
  read-only for personal state. The in-app `local` provider is the answer for a
  keyless install (see [localRating](localRating/README.md)); AniList OAuth is the
  upgrade for writes.
