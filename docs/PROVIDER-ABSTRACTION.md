# A generic `Provider` registry — assessed and dropped

> **Status: `Dropped`**, and this file exists to keep it dropped. The verdict is a
> standing rule cited by CLAUDE.md, [LIB-REORG.md](LIB-REORG.md) and
> [PROVIDER-PARITY.md](PROVIDER-PARITY.md).

## The proposal

A common `Provider` interface + registry — `{ id, capabilities, fetchCatalog?,
fetchPersonalList?, fetchRecos?, write? }` — that providers register into, so
hooks, sync orchestration, storage, config and UI iterate a list instead of
naming `mal` / `simkl` / `anilist` by hand.

## Verdict

**Drop the full registry. Abstract only the *uniform* seams.**

A registry earns its keep when the member set is **open / dynamic /
runtime-loaded** (plugin systems, arbitrary gateways). This set is the opposite:
**compile-time-known and finite**, with the plausible additions named in advance.
A registry over a finite known set trades three legible explicit calls for a
`for (provider of PROVIDERS)` loop plus capability-flag branching plus
lowest-common-denominator interfaces. That is ceremony, not leverage.

## The decisive move: "provider" is not one axis — sort the seams

- **Uniform → worth abstracting.** Identity, capability and status. Per-title
  refill returning a per-source `{ ok, outcome }`. These genuinely are the same
  operation across providers, and they are what
  [PROVIDER-PARITY.md](PROVIDER-PARITY.md) D2/E1–E4 built
  (`providers/capabilities.ts`, `providers/registry.ts`, `providers/status.ts`,
  `providers/writers.ts`). That is the light interface this document recommended,
  scoped by what the gaps actually demanded.

- **Heterogeneous → hand-wiring is correct.** A registry here forces conditionals
  and LCD shapes:
  - **Sync orchestration.** MAL's 8-year seasonal crawl, SIMKL's two-phase
    `activities` + `date_from` delta, and AniList's GraphQL batch are *not the
    same operation*. A common `fetchPersonalList()` hides genuinely different
    machinery. (Reaffirmed by PROVIDER-PARITY F1, which kept cron-sync as five
    explicit steps.)
  - **Connection UI actions.** MAL OAuth vs SIMKL OAuth+secret vs AniList's
    anonymous catalog role. A "generic connect" component is a conditional
    pile-up *worse* than explicit ones. Only the **card around** the actions is
    uniform.
  - **The three OAuth token stores.** MAL refreshes, SIMKL doesn't expire,
    AniList is a 1-year clock check.

## Two claims in the original case that did not hold up

- **`RecoSource` is not really provider-hardcoded.** Only 3 of its 12 members
  (`crowd`, `anilistCrowd`, `suggestions`) are provider-tied; the other 9 are
  cross-provider taste dimensions a provider registry has no claim on. And the
  provider-tied ones need *per-source* normalization anyway (`anilistCrowd` has
  its own denominator because AniList `rating` ≠ MAL `num_recommendations`).
  Making it registry-driven would force a URL-param migration to abstract a set
  that is ~25% providers and heterogeneous exactly where it *is* providers —
  cost for negative benefit.

- **The data layer, not the wiring layer, carried the real value.**
  [PROVIDER-FREE.md](PROVIDER-FREE.md) delivered "sources are interchangeable"
  where it matters — a provider-neutral record with a precedence-merged hydration
  engine — without a registry at the wiring layer.

## If a genuinely new provider lands

Add its sync module and its `PersonalWriter`, plus one row in
`providers/capabilities.ts` (a `Record<ProvenanceSource, …>`, so a missing row is
a compile error). Leave sync orchestration and the connection actions hand-wired.
