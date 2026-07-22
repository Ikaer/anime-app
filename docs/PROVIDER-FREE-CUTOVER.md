# Provider-free cutover — the canonical-id store

> Closed. The store and the record have no MAL id and no MAL shape anywhere
> outward or at rest. This keeps the invariants and the phase vocabulary that
> ~27 code comments cite (Phase A–E, "Risks", "Deferred").
>
> Design context: [PROVIDER-FREE.md](PROVIDER-FREE.md) (north star, provider
> feasibility) and [PROVIDER-ABSTRACTION.md](PROVIDER-ABSTRACTION.md) (why the
> wiring-layer registry was dropped).

## What the phases established

| Phase | What it means when code cites it |
|---|---|
| **A** | Identity resolution at ingest — resolve-before-mint, the durable registry, AniList ingest touching the registry. |
| **B** | The store is **re-keyed to canonical id**; the join iterates registry ids, not the MAL catalog's keys. |
| **C** | The **hydration engine** — per-provider partial extractors + generic precedence merge + provenance; `extends MALAnime` dropped; one `AnimeRecord`. |
| **D** | The **outward** id is canonical — every route, deep link, React key, hidden/feedback key and reco `w=` param. |
| **E** | The transitional `AnimeForDisplay` alias retired; every reader is `AnimeRecord`. |

## The invariants

### Identity resolution at ingest

Sources arrive keyed by **provider** id (MAL sync → mal ids; AniList → `idMal` or
anilist id; SIMKL → its `ids` block). Every write goes through one resolver:

```
resolveCanonicalId(providerIds: SourceIds): canonicalId
  1. look up the registry by mal → anilist → simkl (first hit wins)
  2. found  → merge any new provider ids into that entry's crosswalk, return it
  3. missing → MINT a new canonical id, seed its crosswalk, return it
```

- **Resolve-before-mint is mandatory.** A sync must never blind-mint an id for a
  title the registry already anchors, or durable user data (feedback, hidden —
  keyed by canonical id) silently reattaches to the wrong title on the next
  rebuild.
- **The registry is durable and survives rebuilds.** "Rebuild my catalog"
  re-crawls source *data* but preserves the registry; only an explicit hard reset
  deletes it. A monotonic counter id (`a_<n>`) is safe **because of** this
  invariant, not on its own.
- **Collision policy: detect and report, never silently merge** — MAL splits what
  AniList merges, and vice-versa.

### The one record shape

```ts
interface AnimeRecord {
  id: string;                 // canonical id — the ONLY id, outward and internal
  crosswalk: SourceIds;       // { mal?, anilist?, simkl?, ... } — provider ids
  catalog: AnimeCatalog;      // hydrated across providers
  personal: AnimePersonal;    // hydrated across providers (SIMKL > MAL > AniList)
  sources: AnimeSources;      // raw per-provider slices, verbatim
  provenance: RecordProvenance; // per-field origin
  hidden?: boolean;
  discrepancy?: Discrepancy | null;
}
```

### The hydration engine

One mechanism for both catalog and personal:

- Each provider exposes a **`Partial<AnimeCatalog>`** / `Partial<AnimePersonal>`
  extractor. A generic merge walks each field, takes the **first source in
  precedence order with a defined value**, and records the winner in a sibling
  **provenance** map.
- **Values stay flat** (`record.catalog.title` is the string), so no consumer
  reads `.value`.
- Precedence is configurable: catalog **MAL-first** (AniList wins only where MAL
  is absent — satisfies "title only in AniList" without blanking not-yet-crawled
  titles); personal **SIMKL > MAL > AniList**. `getEffective*` became thin reads
  of `record.personal.*`.
- Banner art is just another catalog field, AniList-sourced.

## Deferred

**AniList titles with no `idMal`** were out of scope for the cutover — they have
no way to seed identity from an existing MAL id. (The enrichment half of this was
later closed: see [PROVIDER-PARITY.md](PROVIDER-PARITY.md) B1/B2.)

## Risks / watch-items

- **The reco engine is the deepest MAL-id coupling.** Its internal crowd-edge
  math stays MAL-keyed by design; translation happens only at the
  hydrate / exclude / feedback edges and each item's outward `.id`. See
  [PROVIDER-PARITY.md](PROVIDER-PARITY.md) B3 for the standing decision.
- **`next/image` host allow-list** for the AniList cover/banner CDNs — a blocked
  image host guts first-run.
- **Collision reporting must be visible** (logged), not swallowed.
- **Id stability across rebuilds** is the one invariant that, if broken, corrupts
  durable user data *silently*. Test it explicitly.

## The acceptance test

From an **empty** store: trigger the AniList catalog crawl → the main list
renders real rows **with posters** → each rendered field's `provenance` names
`anilist` → re-run the crawl and canonical ids are unchanged, with no
feedback/hidden reattached to a different title.
