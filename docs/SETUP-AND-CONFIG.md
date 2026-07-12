# First-run setup & runtime configuration

> A **design + plan** document for an independent, self-contained feature.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `Todo`** (proposed 2026-07-12). Deliverable of this document is the
> design; no code has landed yet.

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
  fixed, path-independent location (`process.cwd()/.anime-app.json`, or an OS
  config dir). The first-run wizard writes it; nothing else does.
- **Default** changes from `/app/data` to something that launches locally out of
  the box (e.g. `./data` relative to cwd).
- **Docker/NAS unchanged:** compose sets `DATA_PATH`/`LOGS_PATH` env → env wins →
  the wizard is skipped entirely.

### Tier 1 — App settings (everything else) → `dataPath/settings.json`

- Holds: MAL client id + (optional) redirect uri; SIMKL client id / secret /
  app-name / redirect uri; `CRON_SECRET`; **default title language**; and any
  future display defaults.
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

## What "minimal config" honestly cannot remove

State these so the setup doesn't oversell "zero config":

1. **The user must still create an OAuth app** on MyAnimeList / SIMKL and register
   the redirect URI *there*. The UI can only make the app-side trivial: paste the
   client id, and **display the exact redirect URI to register** (copy button),
   **auto-derived from `req.headers.host`**. Auto-deriving it removes
   `MAL_REDIRECT_URI` / `SIMKL_REDIRECT_URI` from what the user must think about —
   a real config reduction.
2. **Secrets are write-only in the UI.** `SIMKL_CLIENT_SECRET` and `CRON_SECRET`
   must never be sent back to the browser. The settings GET **redacts** them
   (returns `{ set: true }`, not the value); POST accepts a new value or leaves the
   stored one untouched when the field is blank.

## Resulting user flow

1. Launch with zero env → app boots to an empty dashboard. (Today MAL login just
   errors with "client ID not configured"; instead it guides the user to Settings.)
2. **First-run wizard** — only if no `dataPath` resolves from env/bootstrap: pick
   data + log folders → writes `.anime-app.json`.
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
2. **Tier 0 second** — bootstrap resolver + `.anime-app.json` + first-run wizard
   for the data/log folder choice.

## Open questions

- Bootstrap file location: `process.cwd()/.anime-app.json` vs an OS config dir
  (`~/.config/anime-app/`). cwd is simpler and matches the single-deploy model;
  OS dir is tidier for a desktop-style install.
- Should the first-run wizard offer to **create** the chosen folders, or only
  validate that they exist and are writable?
- Whether `default title language` should also expose per-title override later
  (out of scope here).
