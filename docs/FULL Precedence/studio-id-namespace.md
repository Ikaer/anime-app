# The studio id namespace issue

> **Problem E4.** The decision is `studios` should come from AniList. Two distinct
> hazards sit in the way — an **id namespace** hazard and a **producer contamination**
> hazard. They are independent; both must be resolved before the field is flipped.

> ⚠️ **Sequencing note (2026-07-25).** This doc's §2 fix was written as a
> *pre*-sweep task — "make it before the catalog sweep runs". It did not happen:
> the E2 sweep shipped with the `nodes` query, so hazard 2 is **already in the
> store** and hazard 1's measurement is taken against contaminated data. What was
> a precondition is now a **repair**, and it is
> [**Phase 0**](README.md#phase-0--de-contaminate-studios-first-unblocks-the-e4-measurement)
> — the first thing done in this folder, ahead of the precedence mechanism, because
> it is fixing live output rather than preventing future damage. Read §2's "Fix"
> section as the repair spec.

## Relationship to CREDITS-ID-NAMESPACE.md

[../CREDITS-ID-NAMESPACE.md](../CREDITS-ID-NAMESPACE.md) already analysed studio id
namespaces — but for **routing** (`/credits/studio/<id>` collisions), and it
explicitly lists *"any change to catalog precedence"* as a non-goal. It resolved
toward **option D** (source-qualify the id in the route) and **deferred option E**
(mint canonical `s_<n>` ids).

This doc is the other half: the **scoring** consequence of actually switching
`catalog.studios` to AniList. Read that doc first — do not re-litigate its options
here. One line from it matters most:

> the fix ships against a dataset where it is unobservable and cannot be validated
> end to end

That stopped being true when [anilist-catalog-sync.md](anilist-catalog-sync.md)
shipped (2026-07-25). **The previously-unobservable problem is now observable** —
which is exactly why it has to be resolved rather than deferred again.

## Hazard 1 — id namespace fragmentation

The reco studio affinity profile keys on studio **id**, not name:

```ts
// src/lib/reco/scoring.ts
studio: a => (a.catalog.studios || []).map(s => s.id),
```

AniList studio ids are AniList's namespace; MAL's are MAL's. The model already
warns about this:

> Ids are AniList's namespace, NOT MAL's — so a title present on BOTH keeps MAL
> studios under the default MAL-first precedence. Caveat if precedence ever flips
> to anilist-first: the reco studio IDF profile keys off studio `id`, so
> cross-source id mismatch would fragment studio affinity.

**The failure mode is mixed coverage, not the flip itself.** If *every* title's
studios come from AniList, ids are internally consistent and the IDF profile is
fine — it never compares across namespaces. The breakage is a **half-backfilled
store**: some titles carry AniList-id studios, some MAL-id, and the same real
studio then appears as two distinct ids. Studio affinity silently splits in half,
and the reco `studio` source quietly under-weights.

Consequences:

- **Studios-from-AniList and full AniList catalog coverage are the same milestone.**
  Do not flip the field on partial coverage.
- Titles AniList does not have will keep MAL studios by fall-through — permanently
  mixed, at whatever rate that is. **Measure that rate in Phase 0, after the
  `isMain` re-sweep** — the current post-sweep figure (961 MAL-only) is taken
  against contaminated data and will move. If it is non-trivial, mixed namespaces
  are the steady state and option E (canonical studio ids) stops being deferrable.

### Consumers keying on studio id

Complete this inventory during implementation; verified so far:

| Consumer | Keys on | Impact |
|---|---|---|
| `reco/scoring.ts` studio IDF profile | `s.id` | Fragmentation (above) |
| `reco/byCredits.ts` "Dans le même studio / staff" | studio identity | Same-studio matches break across namespaces |
| `/stats` studios dimension | `catalog.studios` | Same real studio counted twice in the ranking |
| `/credits/studio/<id>` route | id in URL | Collisions — the subject of CREDITS-ID-NAMESPACE.md |

## Hazard 2 — AniList `studios` folds in producers

> ⚠️ **Now LIVE in the store, not hypothetical.** The catalog sweep (E2, shipped
> 2026-07-25) ran with the `nodes` query below and wrote AniList `studios` — with
> producers folded in — onto **14,430** both-present titles plus **1,900**
> AniList-only ones. So `catalog/anilist.json` already carries contaminated studio
> lists. This must be re-fetched with the `isMain` fix **before** `studios` is
> flipped to AniList, and the 1,900 AniList-only titles already surface producers
> as studios under the *existing* fall-through (MAL has no studio for them).

The two AniList queries disagree about what a "studio" is:

```graphql
# catalog crawl — CATALOG_FIELDS (anilist/sync.ts)
studios { nodes { id name } }             # ← no isMain filter

# cast query (anilist/cast.ts)
studios { edges { isMain node } }         # ← isMain:false == producer
```

AniList's `studios` connection contains **animation studios and producers
together**; `isMain` is what separates them, and the app already relies on that
split — `cast.ts` treats `isMain: false` as a producer, and producers are surfaced
as their own `/stats` dimension.

`CATALOG_FIELDS` uses `nodes`, which **discards the edge** and therefore the
`isMain` flag. Switching `catalog.studios` to AniList as-is would import producers
*as studios*, which:

- inflates every title's studio list with committees and distributors,
- pollutes the studio IDF profile with near-universal, low-signal entries,
- double-counts in `/stats` (a producer appears in both dimensions),
- contradicts `catalog.studios`' MAL-derived meaning (animation studio).

### Fix — now a repair, not a precondition (Phase 0)

Change `CATALOG_FIELDS` to the edge form and keep only mains:

```graphql
studios { edges { isMain node { id name } } }
```

…mapping `isMain: true` → `catalog.studios`, and updating `RawCatalogMedia` +
`toCatalogEntry` alongside it. Because the sweep already ran with `nodes`, this
now also requires re-fetching the ~19k contaminated entries — and that is **not** a
button press:

**The re-sweep runs off a schema version, not a force flag.** ✅ *Implemented.*
`selectCatalogSweepTargets` skipped on `e.catalog !== undefined`, and every entry
now *has* a catalog block, so a plain re-run selected ~nothing. The backfill signal
was designed to express "never fetched"; it cannot express "the shape changed".
`CATALOG_SCHEMA_VERSION` (in `anilist/sync.ts`) is stamped into each block by
`toCatalogEntry`, and the selector re-queues anything whose `v` doesn't match.

A force flag was the obvious alternative and is the worse one: it restarts from
zero on every interruption of a 15–20 min run, whereas the version stamp keeps the
sweep **resumable by construction** — each batch persists at the new version and
stops re-queueing. It also needs no endpoint or Connections-button change at all;
the existing button and the cron step pick the work up on their own.

**Producers are NOT captured here — deliberately deferred.** The original argument
was "free only if it rides this pass, else a third 19k sweep". A sweep is a
background job on a hobby project and costs nothing, so that argument is void, and
what remains is the cost side: `catalog/anilist.json` is parsed on **every cold row
build**, and this repo's own precedent (`AniListCastEntry`'s doc comment — the
entire reason cast is off-join) is *don't put display-only bulk in a joined slice*.
Producers also already have a home on the cast slice, so storing them here creates
two homes for one datum. Do it as its own task, with its consumer: model field +
`catalogFromAnilist` + the `/stats` read + coverage/dedup against the cast slice +
a re-sweep, together.

## Decision needed

Steps 1–3 are [Phase 0](README.md#phase-0--de-contaminate-studios-first-unblocks-the-e4-measurement);
step 5 is Phase 3 and is the only part that waits on a ruling.

1. ✅ **Fix `CATALOG_FIELDS`** to the `edges { isMain node }` form. Done, and
   verified live against AniList (2026-07-25): HTTP 200 at `perPage: 50` — no
   complexity-ceiling problem — `isMain` never null, and the mains-only mean is
   **1.04 studios/title against MAL's 1.10**, i.e. the filtered list matches what
   `catalog.studios` is supposed to mean. Producers measured **4.35/title**: that
   is the volume that was being stored as animation studios.
2. ✅ **Version-stamp the block** so the ~19k stale entries re-queue (§2's Fix).
3. ⏳ **Re-sweep, then measure two numbers** with `scripts/measure-precedence.js`:
   AniList studio coverage after the fix, and how many titles keep **MAL-id**
   studios by fall-through.
4. ⏳ **Rule on the second number** — this is the open decision. Full coverage ⇒
   the flip is safe. Materially partial ⇒ mixed namespaces are the permanent
   steady state, and either the flip waits or option E gets un-deferred.
   **Pre-fix the mixing rate is already 15.5%** (2,997 of 19,327 titles that have
   studios at all fall through to MAL), and the fix can only push it *up* — every
   title whose AniList entry held producers only now stores `undefined` and falls
   through. Gate 2 looks likely to open; decide against the re-measured figure.
5. Only then set `studios: ['anilist','mal']` in the per-field precedence map.

## Non-goals

- Re-deciding the routing question — that is CREDITS-ID-NAMESPACE.md's option D.
- Minting canonical studio ids **unless** step 2 shows permanent mixed namespaces.
