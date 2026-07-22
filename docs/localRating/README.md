# Local Rating provider

> Shipped. The in-app personal-data provider (`local`) plus the generic write
> registry it forced into existence. This keeps the design decisions; the
> four phase specs are in git history.

## Why it exists

An in-app store of status/score/progress that needs **no external service**, so
the app is fully usable (rating + recommendation seeds) with no MAL/SIMKL
account — and so the **write** path generalizes the way the read path already
had.

The provider-free cutover made provider *reads* generic (the hydration engine).
This made provider *writes* and *comparison* generic, and dropped in `local` as
the trivial always-available instance of the new write abstraction.

## The backbone: local edits had no home of their own

`rating.ts` and `mal-status.ts` used to write personal state **into the MAL
catalog slice's `my_list_status`**, so "a local edit" and "MAL's mirror" were
literally the same bytes.

- For a **MAL user** that was harmless — the remote write round-trips the value
  back.
- For a **local-only user** it was broken: there is no MAL slice to write into, so
  the endpoint 404'd; and even if it hadn't, a value stashed in a MAL mirror is
  conceptually wrong and a MAL big-sync would clobber it.

Local edits now get their own slice (`personal/local.json`, keyed by canonical
id), their own extractor (`personalFromLocal`), and their own precedence tier —
exactly like SIMKL and AniList.

## The single predicate that ties three decisions together

Toggle-default, precedence-`auto`, and write fan-out all collapse into one
question:

> **Is a writable external personal provider connected?**

| Situation | Local enabled? | Writers on a rating edit | Local in precedence |
|---|---|---|---|
| MAL + SIMKL connected | **OFF** (default) | MAL + SIMKL | not a source |
| No external | **ON** (default) | local only | top (only source) |
| Manual: local *alongside* externals | ON (explicit) | local + externals | `localTop` / `localBottom` decides |

Consequences, all deliberate:

- **Zero regression for an existing setup.** With an external writable provider,
  local is simply off and absent from the precedence list entirely — a stray
  slice entry is never consulted. Local is purely additive.
- **"Write-through, no shadowing" falls out for free.** For a MAL user local
  isn't a precedence source at all, so it cannot shadow an external edit. The
  stale-local-value problem never arises.
- **`localTop`/`localBottom` earn their keep in exactly one place** — running
  local next to externals manually. `auto` is the default and resolves on its own.

## The four decisions

1. **Enablement** — a `settings.json` toggle defaulting to `auto` ("on iff no
   writable external provider"). Not an OAuth-style "connect an account" flow;
   there is nothing to connect.
2. **Rating surfaces** — the **detail-page status + score control**
   (`PersonalStateEditor`) is core, because it is the only surface that can create
   local state from nothing: the tier board only shows *already-statused* titles,
   so it is empty for a fresh local user. **No inline card rating** (clutters the
   dense 4K view). The franchise-bulk page is a separable enhancement —
   [docs/quickRate/](../quickRate/README.md).
3. **Precedence** — a `localPrecedenceMode: 'auto' | 'localTop' | 'localBottom'`
   enum. **No `custom` ordered list**: frozen arrays go stale when a provider is
   added, and the only degree of freedom anyone wants is where *local* sits.
   Adding `custom` later is a non-breaking enum extension.
4. **Discrepancy** — generalize the pairwise MAL-vs-SIMKL model to a
   **per-provider map**, rendered in the grouped long format (one sub-row per
   provider under each anime) so a new provider costs a row, not a column.

## The write registry

A provider is writable **iff it registers a writer** — capability, not identity.
That is what let AniList join the fan-out the day its OAuth shipped, with no
endpoint change, and what makes Betaseries "write an extractor + a writer +
register both".

`writePersonal(canonicalId, patch)` in
[providers/writers.ts](../../src/lib/providers/writers.ts) runs **every**
local-authority write before **any** remote push — structurally encoding
local-cache-authority — then fans the remotes out serially. It returns
`{ found, outcomes }`, and both `rating.ts` and `mal-status.ts` are collapsed
onto it.

The local writer must **create, not just edit**: a local-only title has no MAL
slice to mutate. Its `writeRemote` is a no-op that always reports `ok`.

See [PROVIDER-PARITY.md](../PROVIDER-PARITY.md) D1/D2 for the capability
narrowing and enablement predicate that later moved *out* of the writers.

## Known limit — don't oversell

Local scores do seed the reco feed (`getSeeds` reads effective `personal.*`).
**But crowd expansion is MAL-keyed**: the internal candidate map keys on
`crosswalk.mal`, and MAL/AniList crowd edges arrive as MAL ids.

- AniList-catalog-crawled titles carry `idMal` → `crosswalk.mal`, so a keyless
  install whose catalog came from the onboarding crawl **does** pull crowd recos.
- A title with **no MAL crosswalk at all** can be a seed but pulls no crowd
  edges — only the taste-profile sources re-rank it.
