# First-run setup & runtime configuration

> Shipped. The two-tier config model, the security posture, and what is still
> deferred.

## Goal

The app **just launches** with zero configuration, and provider credentials /
preferences are entered at runtime on a `/settings` page rather than in env vars.
The env-var system does not go away — it stays as the Docker/NAS path and as a
fallback.

## The core constraint: a bootstrap paradox

Nearly every config value *could* live in a JSON file under `DATA_PATH`. Two
cannot: **`DATA_PATH` and `LOGS_PATH` themselves** — you cannot store the
location of the data folder inside the data folder. And a plain env var cannot
satisfy "choose the folder in setup" either: env is fixed at process start, so
"choose it in setup" would really mean "edit `.env` and restart".

That forces a persistence layer **outside `DATA_PATH`**, and splits configuration
into two tiers. The whole design flows from this split.

## Two config tiers

### Tier 0 — bootstrap (`dataPath` + `logsPath` only)

Resolution order: **env var → fixed-location bootstrap file → built-in default**.

- The bootstrap file is the **only** thing outside `DATA_PATH` — a small JSON at a
  fixed, path-independent **OS config location** (`%APPDATA%\anime-app\` on
  Windows, `~/.anime-app/` elsewhere).
- **The default is an out-of-checkout OS location**, deliberately *not* `./data`
  relative to cwd: a cwd-relative default can land inside the git working tree and
  get a secrets-bearing `settings.json` accidentally committed or swept into a
  Docker build context.
- **The wizard is optional polish, not a gate.** Because the default already
  resolves to a real writable folder, the app boots with zero config; a wizard
  would only fire for a *non-default* folder.
- **Docker/NAS unchanged** — compose sets the env vars, env wins.

### Tier 1 — app settings → `dataPath/settings.json`

MAL client id; SIMKL client id / secret / app-name; `CRON_SECRET`; display
preferences. Read/written through `config/settings.ts` on the existing
`jsonStore` primitives, edited from `/settings`.

**OAuth redirect URIs are not settings.** They are derived from the request host
([redirectUri.ts](../src/lib/redirectUri.ts), honouring `X-Forwarded-Host`/`-Proto`
then `Host`) and used *in the flow itself*, so the value shown for registration is
byte-identical to the one sent. There is no scenario for a redirect host other
than the one serving the app. The env vars survive only as a silent escape hatch
for a proxy that strips `X-Forwarded-*`.

## Precedence: per-field, no seeding

```
settings.json[field]  ??  process.env[field]  ??  default
```

**Do not seed `settings.json` from env on first boot.** Seeding is a clobber
trap: a Docker user who later edits their env finds it silently ignored because
the seed exists — or, the other way, env always wins and UI edits get clobbered.
`settings.json` stays **sparse**, holding only fields the user actually set. No
migration step, no precedence ambiguity.

## Security posture

Moving provider credentials from env into `settings.json` is **not a new trust
boundary**, but that holds only because of three things — stated as requirements,
not assumptions:

- **The boundary already exists.** `auth/mal.json` in the same store holds a live
  OAuth access + refresh token, which is *more* powerful than a client secret.
  Anyone who can read `DATA_PATH` already owns the account.
- **Only two fields are truly sensitive** — `SIMKL_CLIENT_SECRET` and
  `CRON_SECRET`. Client ids, redirect URIs and app-name are public by design.
- **Secrets are write-only over HTTP.** The settings GET **redacts** them
  (returns `{ set: true }`, never the value); POST accepts a new value or leaves
  the stored one untouched when blank. The browser is the one genuinely new
  attack surface.

Plus: keep the store out of git (`.gitignore`, belt-and-braces behind the
out-of-checkout default), and write `settings.json` / `config.json` `0600`.

**No encryption at rest — a deliberate non-goal.** For a single-user NAS app,
plaintext matches the existing token posture; encrypting one file while the token
sits in cleartext beside it buys nothing.

## What "minimal config" cannot remove

The user must still **create an OAuth app** on MyAnimeList / SIMKL / AniList and
register the redirect URI there. The UI makes the app-side trivial: paste the
client id, copy the exact redirect URI shown next to the field.

## Separation of the two pages

**Settings = provider app credentials + preferences.**
**Connections = per-account auth + sync actions.**

## Known caveat

`DATA_PATH` resolves as a **module-level const at import time**, so changing the
data folder at runtime requires a **restart**. For a single-user app that is an
acceptable trade and not worth engineering around — the `/settings` folder editor
shows a restart-required note.

## Deferred

- **The guided first-run wizard flow** — a redirect/step-through for brand-new
  installs. The per-field editing all exists; only the onboarding funnel is
  missing. (The empty-store onboarding that *does* exist is a different thing —
  it seeds the catalog, not the config.)
- **`defaultTitleLanguage`.** Its rendering seam `getPrimaryTitle` is
  English-hardcoded across ~15 server + client call sites, so it is a separate
  cross-cutting change. Note this is a **server-side** knob (titles render in
  `getServerSideProps`), unlike the FR/EN **UI** language which is client
  `localStorage` — two different knobs, easily conflated.
