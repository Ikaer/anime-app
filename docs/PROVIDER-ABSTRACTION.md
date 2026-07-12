# A real `Provider` abstraction

> A **design + plan** document for an independent, self-contained refactor.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `Todo`.** Large, high blast radius. Pure code-health / extensibility
> — no user-facing payoff on its own. Worth it only when adding a 4th+ provider
> (Jikan / Kitsu / Shikimori) is actually on the table.

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
