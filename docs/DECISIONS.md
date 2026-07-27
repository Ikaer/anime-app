# Standing decisions

Questions that are **closed**. Each entry is a ruling plus the one fact that
makes it a ruling — enough to stop it being re-opened, not a record of how it was
reached. That record is in git.

`CLAUDE.md` is the map of how the app works today; this file only answers "why
isn't it the other way?".

## Identity

**The canonical id is synthetic (`a_<n>`), minted by the registry.** Chosen over
reusing the MAL id because a keyless install may have no MAL id at all. Safe only
because the registry is durable and every write path resolves-before-mint —
blind-minting reattaches durable user data to the wrong title on the next rebuild.

**Provider ids are converted to canonical at the boundary.** Past ingest,
everything speaks canonical, and each provider is queried with **its own** id.
If the crosswalk holds no id for a provider, that provider simply does not enrich
that title — no gap-bridging, no foreign key promoted to a primary key.

**Precedence and join identity are different layers.** Precedence decides which
provider *fills a field*; join identity decides which key *groups records*.
"Precedence has no exceptions" and "some things are legitimately MAL-keyed" are
both true. Seeing `crosswalk.mal` in `feed.ts` is not evidence of unfinished work.

**Three MAL-keyed spots are deliberate** (`CLAUDE.md` K4–K7 has the full table):
`/rate?id=`, `getMalIdForCanonical`, the legacy URL redirects, and the "added to
MAL" fields. Plus one live `Media(idMal:)` in `anilist/write.ts` — crosswalk
resolution for a *write*, where refusing would drop a user's rating.

**~22% of the registry holds no AniList id, and that is irreducible.** The back
catalog was crawled to 1960 and moved the gap by *zero*; 30 sampled gap titles
returned 0 hits when asked for individually. They are recaps, specials, PVs, CMs,
music videos and CN/KR web animation that MAL lists standalone and AniList does
not carry. **Do not attack this with a wider crawl window again.**

**Collision policy: detect and report, never silently merge.** MAL splits what
AniList merges and vice-versa. What a *merge* should do is still undecided — but
nothing merges today.

## Catalog precedence

**AniList is not the catalog north star, deliberately.** Precedence is per-field
and user-configurable in `/settings`; `/precedence?id=` shows what won and why.

- **`mean` is pinned to MAL** — larger voter base, and it backs `minScore`/
  `maxScore`, so a mixed source means mixed filter semantics in one sorted list.
- **`studios` stays on MAL.** The AniList coverage advantage was producers
  miscounted as animation studios (`nodes` instead of `edges { isMain }`). Once
  fixed: MAL covers 15,391 titles to AniList's 12,254, and AniList's 524 unique
  titles already fall through under MAL-first. A flip would gain zero coverage
  and swap id namespaces on two-thirds of the catalog.
- **`genres` is unioned, not arbitrated.** Element-wise merge across providers,
  which works because genres are already name-keyed. Measured: +11,087 genre
  assignments, vocabulary unchanged at 78. A straight flip to AniList's cleaner
  19-value taxonomy would have discarded 60 values.
- **The three axes inside `genres` are a derived lookup** (`domain/genreAxis.ts`),
  not three catalog fields — the partition is a function of the name, so there is
  no migration and a misclassification is an array edit.

**Studio identity is keyed on the normalized name, not `s.id`.** Namespace mixing
is live at ~2% (AniList-only-studio titles carry AniList ids under fall-through),
which was double-counting in `/stats` and fragmenting the reco IDF — and because
IDF rewards rarity, a split studio looks *rarer* and its weight goes **up**. Name
agreement is 87.9% under normalization.

**Canonical ids for studios/staff — deferred with a reason.** Minting them needs
exactly the same fuzzy name reconciliation to build the crosswalk, so the name key
is that work minus the id-minting, the migration and a new store file. Revisit if
credits become a first-class surface. The routing half is still open — see
[CREDITS-ID-NAMESPACE.md](CREDITS-ID-NAMESPACE.md).

**Union was rejected for studios**, and the asymmetry with genres is the useful
part: studios have no cross-source dedupe key, and 4.6% of the time a union lists
one real studio twice.

**Tags are not a substitute for genres.** They are a crowd-ranked open-ended
descriptor set; genres are a small closed taxonomy. The app scores them as
separate reco sources for that reason. Do not re-propose collapsing one into the
other to paper over a vocabulary gap.

## Providers

**Personal precedence is SIMKL > MAL > AniList**, one decision for the whole
block rather than per-field. Settled; this is the *catalog* file's counterpart,
not an open question. AniList sits last even when OAuth'd — first on catalog,
absent-tolerant refill pipe on personal.

**No generic `Provider` registry.** A registry earns its keep when the member set
is open/dynamic; this one is compile-time-known and finite. Sort the seams
instead:

- **Uniform, so abstracted** — identity, capability, status, the writer registry.
- **Heterogeneous, so hand-wired** — sync orchestration (MAL's seasonal crawl vs
  SIMKL's two-phase delta vs AniList's GraphQL batch are not the same operation),
  the connection actions, and the three OAuth token stores (MAL refreshes, SIMKL
  doesn't expire, AniList is a 1-year clock check).

`RecoSource` is not really provider-hardcoded either: only 3 of 12 members are
provider-tied, and those need per-source normalization anyway.

**AniList is the default catalog provider because it is the only one needing no
setup**, and it covers catalog + crowd recos + tags/staff. Its anonymous tier is
verified, at the degraded 30 req/min ceiling.

**Jikan is kept but demoted — never the default.** It serves MAL's own data in
MAL's shape keyed by MAL id, so leaning on it would satisfy no-key onboarding
while entrenching the exact coupling a provider-neutral core exists to remove.
Legitimate only as an optional import.

Candidates whose ids are already in the crosswalk, so adding one to *identity*
costs nothing and adding one as a *data source* is a new sync module: Kitsu
(public JSON:API), Shikimori (MAL-like, public reads), AniDB (authoritative
catalog, restrictive API + registration), Trakt/TMDB (weak anime coverage).

**The AniList personal import is authenticated-only, and that is load-bearing.**
The anonymous by-username tier shipped and was removed: post-OAuth it read a list
the user could not write back to. Removing it closed the discrepancy actionability
gate for free — every entry in the slice now belongs to a connected account.

**SIMKL's write carve-out is TWO operations, not one — ratings and removals.**
The one-way-in rule stands (nothing automatic ever writes to SIMKL); this is the
second *user-initiated* exception. Excluding removal was considered and is wrong
for a structural reason, not a convenience one: SIMKL is **first** in personal
precedence, so an entry left behind there keeps `getEffectiveStatus` returning a
status after every other provider has cleared theirs — a "clear status" that
visibly does nothing. And `canClearStatus()` requires *every* enabled provider,
so leaving SIMKL out would mean the control never renders on a SIMKL install at
all.

**Entry deletion is remote-first, inverting local-cache authority — deliberately.**
Everywhere else the local slice is written before any remote, so a hung remote
can't cost the user their edit. For a *removal* that is actively harmful: a local
entry deleted while the remote survives doesn't persist as a visible discrepancy,
it **silently reverts** on the next sync (`importAnilistPersonalList` full-replaces
the AniList slice; MAL's list sync rewrites `my_list_status`), after the UI
reported success. A visible discrepancy is the better failure, so the local drop
is conditional on the remote confirming.

**No shared "already gone" convention across providers.** Live-measured, they
disagree completely: MAL's DELETE is idempotent (200 on an absent entry),
AniList's second delete is a 400 validation error, and SIMKL's `deleted` counter
reports 1 either way and cannot be read as an effect signal at all. Each writer
normalizes its own; a shared helper would get two of the three wrong.

## Store & code layout

**Role folders, not provider folders.** The alternative files a 39 MB catalog
next to an auth token, splits the four personal slices across three folders, and
has no home for `local` or the registry. Details in
[DATA-LAYOUT.md](DATA-LAYOUT.md).

**One transport + one throttle per external API.** Four independent AniList
throttles could not cooperate: two concurrent sweeps each respected 28 req/min
while together exceeding the ceiling. The throttle is a slot allocator, not a
sleep — so a caller that also sleeps is double-pacing.

**The client/server boundary is enforced by eslint, not by convention.** A
legitimate `import type` becoming a value import drags `fs` into a client bundle
and the compiler will not stop it. It must be
`@typescript-eslint/no-restricted-imports` specifically for `allowTypeImports`.
A restriction rule that never fires is indistinguishable from no rule — verify it
actually triggers.

**Size is not the smell**; export count and concern count are. `ratingGrids.ts`
and `url/animeParams.ts` are large because they are data tables, one concern each.

**Not proposed, so they are not rediscovered as ideas:** unifying the OAuth token
stores, a `lib/index.ts` barrel (it would defeat the client/server split), and
breaking up `computeFeed` / `performRecommendationsRefresh` (long because they are
genuinely sequential pipelines).

**Verifying a refactor here, given there are no tests:** a clean build proves
paths, not behaviour. Compile `src/lib` + `src/models` to CommonJS in a scratch
dir with a `@/`→`src/` require hook, run the function against a real store before
and after, and diff the dumps. **Point `DATA_PATH` at a copy, or probe read paths
only** — a probe that writes can persist state the app treats as terminal (an
empty `characters: []` cast entry short-circuits forever).

## Lessons that generalize

- **Look for the duplicate before adding the branch.** A feeder is usually
  hardcoded because the mapping it needs exists twice.
- **Ask what refuses the request before the code you are looking at runs.** Three
  of four items in one inventory were larger than their evidence line, always the
  same way: the stated gap was a missing capability, the real gap was a *guard* in
  front of a capability that already existed.
- **Verify that a path still fires, not only that its output did not change.**
  Presence detection was dead for two releases, and a row count dropping to zero
  reads exactly like "no discrepancies today".
- **A ranked inventory can hide a gap by adjacency** — one item being marked
  "deliberate, dropped" made a whole area look inventoried.

## Label glossary

Code comments cite these ids. One line each so a reader can resolve them without
a doc that no longer exists.

**Provider-free cutover — `Phase A`–`E`, `P3a`/`P3b`:** A = identity resolution at
ingest (resolve-before-mint, durable registry). B = store re-keyed to canonical.
C = the hydration engine (per-provider extractors + precedence merge + provenance;
`extends MALAnime` dropped). D = the outward id is canonical everywhere. E = the
transitional `AnimeForDisplay` alias retired. P3a = catalog precedence widened past
title/mean. P3b = the AniList personal import.

**Provider parity — `A1`–`H1`:** A1 one extractor table, two consumers. A2 the
presence anchor is ONE provider, not a set. B1 enrichment queryable by either id
space. B2 single-title refresh takes the id space as a parameter. B3 *superseded*
— the reco engine no longer stays MAL-keyed; see "Identity" above. B4 MAL *ids* ≠
MAL *auth*. C1 list views read the effective seam. D1 a discarded write is
declared, not reported as success. D2 one capability descriptor, split on
client-safety. E1–E4 a Connections card is a (provider, role) pair. F1 no provider
gates the scheduled run. G1 CLAUDE.md drift is a defect. H1 MAL's personal state
is its own slice.

**Full precedence — `E1`–`E11`:** E1 per-field catalog precedence. E2 the AniList
catalog sweep (0 → ~20k `catalog` blocks). E3 genres unioned. E4 studios stay MAL.
E5 precedence user-configurable. E6 the `/precedence` inspector. E7 raw-`sources.*`
reads audited. E8 AniList queried only by AniList ids. E9 reco internals converted
to canonical at ingest. E10 the reco cache is canonical + versioned. E11
`RECS_QUERY` keeps `mediaRecommendation { id idMal }`.
