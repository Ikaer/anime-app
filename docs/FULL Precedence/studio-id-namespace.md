# The studio id namespace issue

> **Problem E4.** The decision is `studios` should come from AniList. Two distinct
> hazards sit in the way — an **id namespace** hazard and a **producer contamination**
> hazard. They are independent; both must be resolved before the field is flipped.

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

That is no longer true once [anilist-catalog-sync.md](anilist-catalog-sync.md)
lands. **This work makes the previously-unobservable problem observable** — which
is exactly why it has to be resolved rather than deferred again.

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
  mixed, at whatever rate that is. **Measure that rate after the sweep**; if it is
  non-trivial, mixed namespaces are the steady state and option E (canonical studio
  ids) stops being deferrable.

### Consumers keying on studio id

Complete this inventory during implementation; verified so far:

| Consumer | Keys on | Impact |
|---|---|---|
| `reco/scoring.ts` studio IDF profile | `s.id` | Fragmentation (above) |
| `reco/byCredits.ts` "Dans le même studio / staff" | studio identity | Same-studio matches break across namespaces |
| `/stats` studios dimension | `catalog.studios` | Same real studio counted twice in the ranking |
| `/credits/studio/<id>` route | id in URL | Collisions — the subject of CREDITS-ID-NAMESPACE.md |

## Hazard 2 — AniList `studios` folds in producers

**This one is not documented anywhere yet.** The two AniList queries disagree about
what a "studio" is:

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

### Fix

Change `CATALOG_FIELDS` to the edge form and keep only mains:

```graphql
studios { edges { isMain node { id name } } }
```

…mapping `isMain: true` → `catalog.studios`. This is a **query-shape change inside
the sweep**, so make it *before* the catalog sweep runs — otherwise ~19k entries
are persisted with contaminated studio lists and need re-fetching.

**Opportunity:** the same edge also yields `isMain: false` producers for every
title. Producers currently exist *only* where the cast sweep has reached, which is
the statused list (~500–700 titles) rather than the catalog. Capturing them here
would make `/stats`' producers dimension catalog-complete for free. Optional, but
nearly free once the edge is queried.

## Decision needed

Before flipping `studios`:

1. **Fix `CATALOG_FIELDS`** to the `edges { isMain node }` form (blocking — must
   precede the sweep).
2. **Run the sweep**, then **measure AniList studio coverage**. Full ⇒ flip is
   safe. Materially partial ⇒ mixed namespaces are permanent, and either the flip
   waits or option E gets un-deferred.
3. **Decide whether to capture producers** from the same edge (recommended).
4. Only then set `studios: ['anilist','mal']` in the per-field precedence map.

## Non-goals

- Re-deciding the routing question — that is CREDITS-ID-NAMESPACE.md's option D.
- Minting canonical studio ids **unless** step 2 shows permanent mixed namespaces.
