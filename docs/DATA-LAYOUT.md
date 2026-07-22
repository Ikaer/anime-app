# Data layout — the on-disk store

> Closed. The store is organized into role folders; this keeps the layout, the
> rules that pick it, and the migration contract (scripts and code comments cite
> this file).
>
> **Older `§n` citations in code map to named sections here:** §3.1 (the full
> old→new mapping) now lives only in `scripts/migrate-layout.js`'s `MOVES` table,
> which is its authority; §3.2 → *The rules* (the connection log); §4 (orphan
> files) → *Migration contract*, `--sweep-orphans`; §5.2 → *Migration contract*,
> the runbook and the refuse-to-start check.

## Why folders, not filename prefixes

The store used to be 22 files in one flat folder with the taxonomy encoded as
prefixes — `animes_`, `mal_`, `simkl_`, `anilist_`, `recommendations_`. **The
prefixes were folders, badly spelled**, and they sorted into groupings nobody
wanted (a catalog slice filing next to a personal one, its actual peer five
entries away).

The cost was not tidiness. It was that **no question about the store could be
answered by looking at it**: which files feed personal precedence, which survive a
provider disconnect, which are caches safe to delete, which are authoritative
user data that must be backed up. Each of those is now an `ls`.

## Layout

```
<DATA_PATH>/
  settings.json                  # tier-1 config
  registry.json                  # the identity spine
  catalog/
    mal.json                     # MALAnime — pure catalog
    anilist.json                 # AniListMetaEntry: catalog, tags, staff, banner, relations
    anilist_cast.json            # characters + seiyuu; off the hot-path join by design
  personal/
    mal.json                     # MALPersonalEntry
    simkl.json
    anilist.json
    local.json
  user/
    hidden.json
    reco_feedback.json
    reco_dismissed.json          # legacy read-only; still excluded from the feed
  auth/
    mal.json  simkl.json  anilist.json
    oauth_state_mal.json         # transient CSRF state, one file per provider
    oauth_state_simkl.json
    oauth_state_anilist.json
  sync/
    mal_seasons.json             # seasonal-crawl checkpoint
    simkl_checkpoint.json        # all-items watermark + lastRatedAt
    anilist_import.json          # last-import count/date
  cache/
    recommendations.json         # rebuildable: crowd/AniList seeds + hydrated candidates
  logs/
    connection_log.json          # the sync-progress feed — app data, not diagnostics
```

## The rules

**Organized by role, not by provider.** The alternative (`mal/`, `simkl/`,
`anilist/`) files a 39 MB catalog next to an auth token, splits the four personal
slices across three folders, and has no home at all for `local` or the registry.
Role also mirrors how the code is organized (`personalState.ts`, `writers.ts`,
personal precedence) and how the Connections UI is split — *what is my catalog,
and which lists am I syncing?*

**`personal/` holds exactly one file per `ProvenanceSource`** — the same set
precedence ranges over, `writers.ts` registers, and `buildProviderStates`
iterates. That rule is the folder's whole point: a missing file becomes a visible
bug rather than something to remember, and adding a provider is "add a file, add
a `ProvenanceSource`" with no third place to update.

**Two files stay at the root, for reasons:**

- `settings.json` — tier-1 config, read before the rest of the store exists.
  Filing it under a data folder inverts the dependency.
- `registry.json` — the identity spine every other file's keys resolve through.
  It belongs to no role because it is what the roles hang off.

**Names shed their prefixes**, since the folder carries them. The same basename
under `catalog/` and `personal/` is the point, not a collision.

**The three `oauth_state` files stay separate.** Merging them into one
`{provider: state}` map was proposed and rejected while building: three modules
read-modify-write their state independently, so one shared file makes concurrent
logins a clobber race — for no gain on data that expires in ten minutes.

**`connection_log.json` is app data, not diagnostics.** It is the progress feed
the Connections panel and the onboarding bar *poll* (there is no SSE for
meta-sync, the cast sweep or the catalog crawl — the log **is** the transport), so
it lives under `DATA_PATH`. Consequence: **`LOGS_PATH` has zero consumers.** It
stays a valid, displayed setting reserved for real debug output — better than
keeping a feature's data under a diagnostics path to justify the setting.

## Code contract

- **`dataFile()` is the single seam** ([store/jsonStore.ts](../src/lib/store/jsonStore.ts)) —
  `path.join(DATA_PATH, name)` handles `'personal/mal.json'` on both platforms.
- **`ensureDataDirectory()` creates the file's own parent**, not just
  `DATA_PATH`. Otherwise the first write to `personal/mal.json` `ENOENT`s on a
  fresh install.
- **The parse cache keys on absolute path**, so a move naturally misses the old
  entry.
- **Docker needs no change** — `/app/data` is one volume mount.

## Migration contract

`node scripts/migrate-layout.js <dataPath> [--dry-run] [--sweep-orphans]`

The conventions, shared with `migrate-canonical.js` and worth reusing for the
next one:

- **Order per file:** write the new path → verify it parses and matches → remove
  the old. A crash mid-run leaves both copies, never neither.
- **Idempotency:** new exists and old does not → no-op. **Both exist → refuse and
  report** (an interrupted run, or the app wrote to the old path after a partial
  migration); never last-writer-wins. Neither → skip.
- **Unknown files:** report and leave. It is either a file the plan missed or
  something the user put there; both deserve a human.
- **Destructive steps are opt-in** (`--sweep-orphans`) and separate from the move.

**Runbook:** back up → stop the app → `--dry-run` → run → deploy → start. A
script, not a startup migration: a migration that runs inside a container on a
NAS is one whose output nobody reads, and this one deletes.

**The sharp edge:** the old image cannot read the new layout and the new image
cannot read the old one, so a wrong order shows up as an app booting onto an
empty store — indistinguishable at a glance from data loss. Hence the
**refuse-to-start check** on a pre-layout store (flat `animes_*.json`, no
`catalog/`). Two things about it:

- **It is lazy, on the first read — not at import time.** Module scope also runs
  during `next build`'s page-data collection, which would fail the build on any
  dev machine whose own store is pre-layout.
- **The "checked once" flag latches only on success.** Setting it before the
  throw makes just the *first* read of each bundle fail and every later one pass —
  strictly worse than no check: the list API recovers, the onboarding gate reads
  an empty registry, and first-run onboarding renders over a full store.

## Which copy of the store gets migrated

`DATA_PATH` is configuration and several copies exist — they are not rivals, each
is a different install:

| Copy | What it is |
|---|---|
| `\\syno\root4\AppData\AnimeTracker\data` | **Production.** The NAS volume mounted at `/app/data`. |
| `E:\Workspace\local\AnimeTracker\data` | A **pull of production** for local debugging. |
| `%APPDATA%\anime-app\data` | The **first-launch default**. |

- **Production is the one that matters**, and the script must run against the
  *mounted* path — pass `<dataPath>` explicitly rather than relying on env.
- **The debug copy is downstream: re-pull it, do not migrate it.** Migrating it
  separately just creates a second thing that can disagree.
- **The pull scripts mirror with `/PURGE`.** They are a `robocopy /E` mirror, so
  new folders come across on their own — but without `/PURGE` the destination
  *keeps* its old flat files alongside them, and the layout guard then refuses to
  start on what looks like a half-migrated store.
