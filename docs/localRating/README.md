# Local Rating provider

Add a **local personal-data provider** — an in-app store of status/score/progress that
needs no external service — so the app is fully usable (rating + recommendation seeds)
with no MAL/SIMKL account, and so the write path generalizes cleanly for the upcoming
**Betaseries** provider and a future **AniList writer**.

This is a four-phase feature. It finishes the job the provider-free cutover started:
that work made provider **reads** generic (the hydration engine); this makes provider
**writes** and **comparison** generic, and drops in "local" as the trivial always-available
instance of the new write abstraction.

---

## The backbone: local edits currently have no home of their own

Today `rating.ts` and `mal-status.ts` write personal state **into `animes_mal.json`'s
`my_list_status`** (`getAllAnime()` → mutate → `saveAnime()`). So "a local edit" and
"MAL's mirror" are literally the same bytes.

- For a **MAL user** this is harmless: the remote write round-trips the value back, and the
  MAL slice staying authoritative is fine.
- For a **local-only user** (the friend, Betaseries-only) it is **broken**: there is no MAL
  slice to write into, so the endpoint 404s, and even if it didn't, a value stashed in a
  "MAL mirror" file is conceptually wrong and a MAL big-sync would clobber it.

**The local provider is the fix for that conflation.** Local edits get their own slice
(`animes_local_personal.json`, keyed by canonical id), their own extractor
(`personalFromLocal`), and their own precedence tier — exactly like SIMKL and AniList
already have. `animes_mal.json` goes back to being a pure MAL mirror.

## The single predicate that ties three decisions together

Toggle-default, precedence-`auto`, and write-fan-out all collapse into **one** question:

> **Is a writable external personal provider connected?** (MAL, SIMKL, or — later —
> AniList/Betaseries with a registered writer.)

| Situation | Local enabled? | Writers on a rating edit | Local in precedence |
|---|---|---|---|
| **You** (MAL + SIMKL) | **OFF** (default) | MAL + SIMKL (today's `rating.ts`, unchanged) | not a source |
| **Friend** (no external) | **ON** (default) | local only → `animes_local_personal.json` | top (only source) |
| Manual: local enabled *alongside* externals | ON (explicit) | local + externals | `localTop` / `localBottom` decides |

Consequences, all deliberate:

- **Zero regression for the existing setup.** With no external writable provider, local is
  simply off; the current MAL+SIMKL write path is preserved byte-for-byte. Local is
  **purely additive**.
- **Precedence model B ("write-through, no shadowing") falls out for free.** For a MAL user,
  local isn't even a precedence source, so it can't shadow an external edit. The
  "stale/redundant local value" problem never arises.
- **`localTop`/`localBottom` earn their keep in exactly one place** — the manual edge case of
  running local next to externals. This is *not* a decision every user makes; `auto` is the
  default and resolves correctly on its own.

## The four decisions (settled in design)

1. **Enablement** — a `settings.json` toggle, defaulting to `auto` = "on iff no writable
   external provider". Not an OAuth-style "connect an account" flow (nothing to connect).
2. **Rating surfaces** — the **detail-page status + score control** is a core phase (phase 3):
   it's the only surface that can create local state from nothing (the tier board only shows
   *already-statused* titles, so it's empty for a fresh local user). **No inline card rating**
   (clutters the dense 4K view). The franchise-bulk **quick-rate page** is a *separable*
   enhancement — spec'd in **[docs/quickRate/](../quickRate/README.md)**, depends on this
   feature but isn't part of it.
3. **Precedence** — a `precedenceMode: 'auto' | 'localTop' | 'localBottom'` enum. `auto` is
   the default and resolves via the predicate above. **No `custom` ordered list** — deferred
   until a real need appears (frozen arrays go stale when a provider is added; the only DOF
   anyone wants is where *local* sits). Adding `custom` later is a non-breaking enum
   extension.
4. **Discrepancy** — generalize the pairwise MAL-vs-SIMKL model to a **per-provider map** so
   it scales to N providers, rendered in the grouped long format (one row per provider under
   each anime).

## Build order

Each phase leans on the previous, so build in order:

1. **[01 — Local provider](01-local-provider.md)** — new slice + extractor + settings toggle
   + `auto` precedence resolver. Un-conflates local edits from the MAL slice. *Reads work
   end-to-end after this; nothing writes to local yet.*
2. **[02 — Write registry](02-write-registry.md)** — replace the hardcoded MAL+SIMKL
   fan-out with a per-provider writer registry keyed on a **capability** (so AniList/Betaseries
   slot in later for free). Local is its first pure-local writer. Must **create, not just edit**
   (a local-only title has no MAL slice to mutate).
3. **[03 — Rating UI](03-rating-ui.md)** — the detail-page status + score control, the bootstrap
   surface that first writes local state (without it a local-only user can enter nothing).
4. **[04 — Multi-provider discrepancy](04-discrepancy-multiprovider.md)** — `computeDiscrepancy`
   pairwise → per-provider map, and every consumer of it.

**Separable enhancement (not a phase):** [docs/quickRate/](../quickRate/README.md) — the
franchise-bulk quick-rate page. Depends on phase 2's `writePersonal`, but nothing here depends
on it.

## Betaseries / AniList-writer readiness

This feature is scoped so the *next* provider is a plugin, not a fork:

- Phase 2's registry keys off a **writer capability**, not provider identity — AniList flips
  from no-writer to writer the day its OAuth is wired, with no structural change; Betaseries
  is "write a `betaseriesFromX` extractor + a `writeBetaseries` writer + register both".
- Phase 4's per-provider discrepancy map is N-provider by construction.

## Known limit to state up front (don't oversell)

The user's motivation includes "make the recommendation page work by giving it seeds." Seeds
themselves work for a local user — `getSeeds` reads effective `personal.*`
([recommendations.ts:311](../../src/lib/recommendations.ts)), which local scores feed. **But
crowd expansion is MAL-keyed**: the internal candidate map is keyed on `crosswalk.mal`
([recommendations.ts:453](../../src/lib/recommendations.ts)) and MAL/AniList crowd edges
arrive as MAL ids.

- AniList-catalog-crawled titles carry `idMal` → `crosswalk.mal`, so a friend whose catalog
  came from the onboarding AniList crawl **does** pull crowd recos. The reco page works.
- A title with **no MAL crosswalk at all** (a hypothetical pure-Betaseries entry) can be a
  seed but won't pull crowd edges — only the taste-profile sources (genre/tag/studio/staff)
  re-rank it. Spec this honestly in the relevant phase; don't promise full crowd recos for
  crosswalk-less titles.
