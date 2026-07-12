# First-run setup & runtime configuration

> A **design + plan** document for an independent, self-contained feature.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `WIP`** (proposed 2026-07-12; implemented 2026-07-12). Landed: the
> Tier-0 bootstrap resolver ([bootstrap.ts](../src/lib/bootstrap.ts),
> out-of-checkout OS default), the Tier-1 settings store
> ([settings.ts](../src/lib/settings.ts)), the redacted settings API
> ([settings/index.ts](../src/pages/api/anime/settings/index.ts)), the
> [`/settings` page](../src/pages/settings.tsx), and the 7 env consumers rewired
> through both. The `/settings` page also edits the **Tier-0 data/log folders**
> directly (writes `config.json` via `writeBootstrapConfig()`, with an env-wins
> badge + restart-required note), so a folder change no longer needs a hand-edited
> file. OAuth **redirect URIs are derived from the request host**
> ([redirectUri.ts](../src/lib/redirectUri.ts)) rather than configured — removed
> from the settings store/UI entirely (env vars kept as a silent proxy escape
> hatch). **Deferred:** the *guided* first-run wizard flow (a redirect/step-through
> for brand-new installs — the per-field editing all exists, just not the
> onboarding funnel) and the `defaultTitleLanguage` preference (its rendering seam
> `getPrimaryTitle` is English-hardcoded across ~15 server+client call sites — a
> separate cross-cutting change).

## Goal

Move the app from **env-var-only configuration** to a flow where it:

1. **Just launches** with zero configuration.
2. Presents a **minimal first-run setup** to choose the data / log folders.
3. Exposes a **dedicated Settings page** where the user adds the rest
   (MAL client id, SIMKL credentials, default title language, …) at runtime,
   instead of editing env vars and restarting.

The env-var system does **not** go away — it stays as the Docker/NAS path and as
a fallback. See [Precedence](#precedence-per-field-no-seeding).

## Current state (2026-07-12)

All configuration is env-var only; there is **no settings store**. The 7 consumers:

| Env var | Consumed in |
|---|---|
| `DATA_PATH` | [jsonStore.ts:12](../src/lib/jsonStore.ts), [connectionLog.ts:4](../src/lib/connectionLog.ts) |
| `LOGS_PATH` | [connectionLog.ts:5](../src/lib/connectionLog.ts) |
| `MAL_CLIENT_ID`, `MAL_REDIRECT_URI` | [auth.ts:16](../src/pages/api/anime/auth.ts) |
| `CRON_SECRET` | [cron-sync.ts:89](../src/pages/api/anime/cron-sync.ts) |
| `SIMKL_CLIENT_ID`, `SIMKL_CLIENT_SECRET`, `SIMKL_APP_NAME`, `SIMKL_REDIRECT_URI` | [simkl/auth.ts:15](../src/pages/api/anime/simkl/auth.ts), [simkl.ts:65](../src/lib/simkl.ts) |

OAuth **connect/disconnect + sync** already have a UI at [connections.tsx](../src/pages/connections.tsx).
What's missing is a place to enter the **provider app credentials** and
**preferences**, and a way to pick the data/log folders without touching env.

## The core constraint: a bootstrap paradox

Nearly every config value *could* move into a JSON file under `DATA_PATH`. Two
cannot: **`DATA_PATH` and `LOGS_PATH` themselves** — you can't store the location
of the data folder inside the data folder. And a plain env var can't satisfy the
"choose the folder in setup" requirement either: env is fixed at process start
and can't be edited from a web page, so "choose it in setup" would really mean
"edit `.env` and restart" — the status quo, not a setup system.

That forces a **persistence layer that lives outside `DATA_PATH`**, and it splits
configuration into two tiers. The whole design flows from this split.

## Design: two config tiers

### Tier 0 — Bootstrap (`dataPath` + `logsPath` only)

- **Resolution order:** `env var → fixed-location bootstrap file → built-in default`.
- The bootstrap file is the **only** thing outside `DATA_PATH` — a small JSON at a
  fixed, path-independent **OS config location** (`~/.anime-app/config.json`; use
  `%APPDATA%\anime-app\` on Windows). The first-run wizard writes it; nothing else
  does. See [Open questions](#open-questions) for why the OS dir beats `cwd`.
- **Default** changes from `/app/data` to an **out-of-checkout OS location** that
  launches locally out of the box: `~/.anime-app/data` and `~/.anime-app/logs`.
  Crucially it is **not** `./data` relative to cwd — a cwd-relative default can
  land inside the git working tree and get a secrets-bearing `settings.json`
  accidentally committed or swept into a Docker build context (see
  [Security posture](#security-posture)).
- **The wizard is optional polish, not a hard gate.** Because the default already
  resolves to a real, writable, out-of-repo folder, the app **boots with zero
  config**; the first-run wizard only fires when the user wants a *non-default*
  folder. This is the "detect at startup and offer to pick a path" flow — it never
  blocks the app from starting.
- **Docker/NAS unchanged:** compose sets `DATA_PATH`/`LOGS_PATH` env → env wins →
  the wizard is skipped entirely.

### Tier 1 — App settings (everything else) → `dataPath/settings.json`

- Holds: MAL client id; SIMKL client id / secret / app-name; `CRON_SECRET`; and
  any future display defaults. (The OAuth **redirect URIs are NOT here** — they're
  derived from the request host, see
  [What minimal config cannot remove](#what-minimal-config-honestly-cannot-remove).)
- Read/written through a new `lib/settings.ts` built on the existing `jsonStore`
  primitives — sits right next to `mal_auth.json`, which already holds the OAuth
  token, so no new trust boundary.
- Edited from a new `/settings` page.

## Precedence: per-field, no seeding

Resolve each field independently:

```
settings.json[field]  ??  process.env[field]  ??  default
```

**Do not seed `settings.json` from env on first boot.** Seeding is a clobber
trap: a Docker user who later edits their env would find it silently ignored
because the seed already exists (or, the other way, env always wins and UI edits
get clobbered). Instead `settings.json` stays **sparse** — it only holds fields
the user actually set in the UI:

- Docker-only users never create a `settings.json`; they keep running purely on env.
- UI users write only the fields they change.
- No migration step, no precedence ambiguity.

## Security posture

Moving provider credentials from env into `dataPath/settings.json` is **not a new
trust boundary** — but that claim only holds if three things are true, so state
them as requirements, not assumptions.

- **The boundary already exists.** `mal_auth.json` (same folder) already stores a
  live OAuth **access + refresh token**, which is *more* powerful than a client
  secret — it grants direct account access with no exchange step. Anyone who can
  read `DATA_PATH` already owns the account; adding `SIMKL_CLIENT_SECRET` /
  `CRON_SECRET` next to it does not widen the blast radius.
- **Only two fields are truly sensitive.** Of the migrated values, only
  `SIMKL_CLIENT_SECRET` and `CRON_SECRET` are secret. Client ids, redirect uris,
  and app-name are public/semi-public by design (client ids ship in OAuth redirect
  URLs). The redaction rules below therefore only *need* to cover those two.
- **Secrets are write-only over HTTP** — the one genuinely new attack surface is
  the browser. The settings GET redacts `SIMKL_CLIENT_SECRET` / `CRON_SECRET`
  (returns `{ set: true }`, never the value); POST accepts a new value or leaves
  the stored one untouched when blank. (Same rule as
  [point 2 below](#what-minimal-config-honestly-cannot-remove).)

**Requirements introduced by this design:**

1. **Keep the store out of git.** Add `data/`, `logs/`, and any cwd-level bootstrap
   artifact to `.gitignore`. The out-of-checkout default
   ([Tier 0](#tier-0--bootstrap-datapath--logspath-only)) is the primary defense —
   this is belt-and-suspenders for anyone who *does* point `DATA_PATH` inside the
   repo.
2. **Restrictive file permissions.** `lib/settings.ts` writes `settings.json`
   `0600` (owner-only). The bootstrap `config.json` gets the same.
3. **No encryption at rest — a deliberate non-goal.** For a single-user NAS app,
   plaintext-at-rest matches the existing `mal_auth.json` posture; encrypting one
   file while the token sits in cleartext beside it buys nothing. Recorded here as
   a decision, not an oversight.

## What "minimal config" honestly cannot remove

State these so the setup doesn't oversell "zero config":

1. **The user must still create an OAuth app** on MyAnimeList / SIMKL and register
   the redirect URI *there*. The UI makes the app-side trivial: paste the client
   id, and **copy the exact redirect URI to register** (shown next to the client-id
   field). **Done (2026-07-12):** the redirect URI is **fully derived from the
   request** ([redirectUri.ts](../src/lib/redirectUri.ts), honoring
   `X-Forwarded-Host`/`-Proto` then `Host`) and used *in the OAuth flow itself* —
   so the value shown for registration is byte-identical to the one sent. It is
   **no longer a setting**: there is no scenario for a redirect host other than the
   one serving the app. `MAL_REDIRECT_URI` / `SIMKL_REDIRECT_URI` survive only as a
   **silent env escape hatch** (a proxy that strips `X-Forwarded-*`), not surfaced
   in the UI. This also fixed a latent bug where the flow sent a `localhost`
   default that no non-local deploy could match.
2. **Secrets are write-only in the UI.** `SIMKL_CLIENT_SECRET` and `CRON_SECRET`
   must never be sent back to the browser. The settings GET **redacts** them
   (returns `{ set: true }`, not the value); POST accepts a new value or leaves the
   stored one untouched when the field is blank.

## Resulting user flow

1. Launch with zero env → app boots to an empty dashboard, using the default
   out-of-checkout data folder (`~/.anime-app/data`). (Today MAL login just errors
   with "client ID not configured"; instead it guides the user to Settings.)
2. **First-run wizard** — optional; offered when the user wants a *non-default*
   data/log folder: pick the folders → writes `~/.anime-app/config.json`. It never
   blocks boot, since the default already resolves.
3. **`/settings`** — paste MAL/SIMKL client credentials (redirect URI to register
   shown inline), set default title language.
4. **`/connections`** (already exists) — OAuth connect/disconnect + sync. Unchanged.

Clean separation: **Settings = provider app credentials + preferences**;
**Connections = per-account auth + sync actions.**

## Touch points

- New `lib/settings.ts` — sparse read/write + a redacted accessor for the API.
- **Tier-0 resolver** feeding [jsonStore.ts](../src/lib/jsonStore.ts) and
  [connectionLog.ts](../src/lib/connectionLog.ts).
- Update the 7 env consumers to route through the resolver / `getSettings()`:
  [auth.ts](../src/pages/api/anime/auth.ts),
  [simkl/auth.ts](../src/pages/api/anime/simkl/auth.ts),
  [simkl.ts](../src/lib/simkl.ts),
  [cron-sync.ts](../src/pages/api/anime/cron-sync.ts),
  [connectionLog.ts](../src/lib/connectionLog.ts),
  [jsonStore.ts](../src/lib/jsonStore.ts).
- New settings API: **redacted GET / POST** under `src/pages/api/anime/settings/`.
- New **`/settings` page** + first-run detection/redirect.
- **Default title language** → `settings.json` (server-side: anime titles render
  in `getServerSideProps`, unlike the FR/EN **UI** language, which is client
  `localStorage` — see the i18n section in CLAUDE.md; these are two different
  knobs and should not be conflated).

## Caveat: runtime folder change needs a restart

[jsonStore.ts:12](../src/lib/jsonStore.ts) resolves `DATA_PATH` as a
**module-level const at import time**. Changing the data folder at runtime
therefore requires a **restart** (or a resolver that re-reads the bootstrap file
per call). For a single-user app, "change folder → restart" is an acceptable
trade and not worth engineering around.

## Suggested build order

1. **Tier 1 first** — `lib/settings.ts` + redacted settings API + `/settings`
   page. Delivers most of the value (runtime credentials + preferences) with no
   bootstrap complexity; the per-field `?? env ?? default` precedence means
   existing env deploys keep working untouched.
2. **Tier 0 second** — bootstrap resolver + out-of-checkout default + OS-dir
   `config.json` + optional first-run wizard for a non-default data/log folder.

## Open questions

- ~~Bootstrap file location: `process.cwd()/.anime-app.json` vs an OS config dir.~~
  **Resolved (2026-07-12): OS config dir (`~/.anime-app/`, `%APPDATA%\anime-app\`
  on Windows).** cwd is marginally simpler, but a cwd-anchored default risks a
  secrets-bearing `settings.json` landing in the git working tree / Docker build
  context, and an OS dir survives a fresh re-checkout of the repo. Since the goal
  is a frictionless local "just run it," the tidier out-of-repo location wins. The
  git risk is really about *where the default points*, not env-vs-file — so we fix
  it once by moving the default out of cwd (see
  [Tier 0](#tier-0--bootstrap-datapath--logspath-only)).
- Should the first-run wizard offer to **create** the chosen folders, or only
  validate that they exist and are writable? (The zero-config default folder is
  auto-created regardless; this question is only about a *user-picked* path.)
- Whether `default title language` should also expose per-title override later
  (out of scope here).
