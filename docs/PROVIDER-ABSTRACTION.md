# A real `Provider` abstraction

> A **design + plan** document for an independent, self-contained refactor.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `Dropped`** (the full registry) **→ superseded by a light
> task-interface, itself `Todo` / defer-until-needed.** Large, high blast radius,
> no user-facing payoff. The registry-over-a-finite-set is speculative generality;
> the value it chases is captured far more cheaply by a small shared interface over
> the *uniform* seams only. See **[Evaluation & decision](#evaluation--decision-2026-07-12)**
> at the bottom.

## What

Introduce a common **`Provider` interface + registry** so sources become a
**configured list**, not hand-wired provider names duplicated across the tree.
The difference between "plug the source you want" as a *slogan* and as an actual
extension point.

Sketch of the interface:

```ts
interface Provider {
  id: string;                    // 'mal' | 'simkl' | 'anilist' | ...
  capabilities: {                // drives which UI/sync paths light up
    catalog?: boolean;
    personalList?: boolean;
    recos?: boolean;
    writes?: boolean;
  };
  fetchCatalog?(...): Promise<...>;
  fetchPersonalList?(...): Promise<...>;
  fetchRecos?(...): Promise<...>;
  write?(...): Promise<...>;
}
```

Providers register into a list; hooks, sync orchestration, storage, config and
UI iterate that list instead of naming `mal` / `simkl` / `anilist` by hand.

## Motivation — how hardcoded is the provider set today? (codebase review)

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
providers for free.

## Blast radius (what the refactor has to touch)

Each hand-wired seam above becomes registry-driven:

- **Types**: the `RecoSource` closed union + `DEFAULT_WEIGHTS` — and because
  weights are persisted in the URL `w=` param, changing the source set needs a
  **URL-param migration**, not just a type edit.
- **Sync**: give each of `mal*.ts` / `simkl*.ts` / `anilistSync.ts` a shared
  interface they implement, so orchestration loops the registry.
- **Hooks / UI**: `useConnections` returns a provider-keyed map derived from the
  registry; the provider-named components (`SimklSection`, `Simkl*Badge`, …)
  become generic, list-driven.
- **Storage / config**: filename-per-provider in `store.ts`, `LogSource` channels
  in `connectionLog.ts`, and `.env.example` all derive from the registry.

## When to do it

Not before there's a concrete 4th provider to add. Until then this is
speculative generality — the three-provider hand-wiring is legible and cheap to
read. Revisit when Jikan / Kitsu / Shikimori (all no-key-friendly, ids already
in the `SourceIds` crosswalk) actually get scheduled.

## Evaluation & decision (2026-07-12)

**Verdict: drop the full registry. Keep a light task-interface over the uniform
seams only, and even that is defer-until-a-concrete-need.**

### Why the registry doesn't pay off

A registry earns its keep when the member set is **open / dynamic / runtime-loaded**
(plugin systems, arbitrary gateways). This set is the opposite — **compile-time-known
and finite** (3 today; Jikan / Kitsu / Shikimori are named in advance). A registry
over a finite known set trades three legible explicit calls for a
`for (provider of PROVIDERS)` loop + capability-flag branching + lowest-common-denominator
interfaces. That's ceremony, not leverage — and the "When to do it" section above already
concedes it's speculative until a 4th provider is real.

### The seams are not one axis — sort them

"Provider" is treated here as a single axis; it's several orthogonal ones, and only
some are uniform enough to abstract. This split is the whole decision:

- **Uniform → worth a light interface:** per-title **refill / status**. The template
  already exists — [`/api/anime/animes/[id]/refresh`](../src/pages/api/anime/animes/[id]/refresh.ts)
  fans out to all three sources and returns a per-source `{ mal, anilist, simkl }`
  outcome. Formalizing that one operation into a small `SourceRefill` shape each
  module implements is cheap and legible. Crosswalk/`SourceIds` is already abstracted.
- **Heterogeneous → hand-wiring is correct; a registry forces conditionals / LCD:**
  - **Sync orchestration** — MAL seasonal 8-year crawl vs SIMKL two-phase
    `activities`+`date_from` delta vs AniList GraphQL batch are *not the same
    operation*; a common `fetchPersonalList()` hides genuinely different machinery.
  - **Connection UI** — MAL OAuth vs SIMKL OAuth+secret vs AniList no-auth /
    anonymous-by-username. A "generic connect" component is a conditional pile-up
    *worse* than three explicit ones. [`useConnections`](../src/hooks/useConnections.ts)
    is honestly hardcoded because the three flows are honestly different.

### The `RecoSource` claim is the weakest part of the case above

The "Motivation" section lists `RecoSource` as provider-hardcoded needing a
URL-param migration. But only **3 of its 12 members** (`crowd`, `anilistCrowd`,
`suggestions`) are provider-tied; the other 9 (`genre`, `studio`, `feedback`,
`rejection`, `popularity`, `anilistTags`…) are **cross-provider taste dimensions**
a provider registry has no claim on. And the provider-tied ones need *per-source*
normalization anyway (`anilistCrowd` has its own denominator because AniList
`rating` ≠ MAL `num_recommendations`). Making `RecoSource` registry-driven would
force a URL-param migration to abstract a set that is ~25% providers and
heterogeneous exactly where it *is* providers — **cost for negative benefit**.

### Relationship to PROVIDER-FREE

[PROVIDER-FREE.md](PROVIDER-FREE.md) (provider-neutral *record* + no-key onboarding)
is the effort carrying the real user value, and it delivers most of the "sources are
interchangeable" promise at the **data layer** — where it matters — without needing a
registry at the **wiring layer**. Once PROVIDER-FREE matures, the registry is largely
redundant.

### What to actually do (if/when a 4th provider lands)

Define a small shared shape for the *uniform* task only — per-source refill/status
returning `{ ok, outcome }` — and have `mal*` / `simkl*` / `anilist*` implement just
that slice. Leave sync orchestration and connection UI hand-wired. This makes "plug
the source you want" true where it's cheap to be true, and skips the migration and
LCD interfaces the full registry would impose.
