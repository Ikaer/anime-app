# Data layout — folders, names, and the orphan sweep

> A **proposal + migration plan** document.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `Todo`** — sequenced behind [PROVIDER-PARITY.md](PROVIDER-PARITY.md)
> H1 (see [§2](#2-prerequisite-h1)); nothing else blocks it.
>
> Scope: how the JSON store is laid out on disk. It changes **no data shapes and
> no keys** — every file keeps its contents and its canonical-id keying. Only
> paths change, plus the deletion of files nothing reads.

## 1. Why

The store is 22 code-referenced files in one flat folder, and the taxonomy that
should be doing the organizing is instead encoded in filename prefixes:

```
animes_mal.json  animes_simkl.json  animes_anilist_meta.json  animes_anilist_cast.json
animes_anilist_personal.json  animes_local_personal.json  animes_hidden.json
animes_registry.json  mal_auth.json  mal_season_checkpoint.json  oauth_state.json
simkl_auth.json  simkl_oauth_state.json  simkl_sync_checkpoint.json
anilist_auth.json  anilist_oauth_state.json  anilist_personal_config.json
recommendations.json  recommendations_dismissed.json  recommendations_feedback.json
settings.json  connection_log.json
```

`animes_`, `mal_`, `simkl_`, `anilist_`, `recommendations_` — **the prefixes are
folders, badly spelled.** They sort alphabetically into groupings nobody wants
(`animes_anilist_personal.json` files next to `animes_anilist_meta.json`, which
is a catalog slice, while `animes_local_personal.json` — its actual peer — sorts
five entries away).

The practical cost is not tidiness. It is that **no question about the store can
be answered by looking at it**: which files feed personal precedence, which
survive a provider disconnect, which are caches safe to delete, which are
authoritative user data that must be backed up. Every one of those requires
reading `store.ts`. The layout below makes each of them an `ls`.

Add to that four files nothing reads and two stale backups ([§4](#4-the-orphan-sweep)),
and roughly a fifth of what looks like the store is not the store.

## 2. Prerequisite: H1

The organizing rule for the `personal/` folder is deliberately mechanical:

> **`personal/` holds exactly one file per `ProvenanceSource`** — the same set
> the precedence list ranges over, `personalWriters` registers, and
> `buildProviderStates` iterates.

That rule is what makes the folder worth having: a missing file becomes a
visible bug rather than something to remember, and adding Betaseries is "add a
file, add a `ProvenanceSource`" with no third place to update.

**Today the rule yields three of four.** `simkl`, `anilist` and `local` have
their own slice files; MAL's personal state is embedded in `animes_mal.json`
alongside the catalog — [PROVIDER-PARITY.md](PROVIDER-PARITY.md) **H1**. Moving
first would bake the anomaly into the new layout (a `personal/` folder
conspicuously missing `mal.json`) and then require a *second* migration over the
same files when H1 lands.

**So: H1 first, then one move.** H1 is independently justified — it also removes
the presence carve-out in `personalState.ts` and stops a rating write from
rewriting 39 MB — and this document is a further argument for it, not a
dependency that makes it more expensive.

**C1 is not a prerequisite** (it is a UI read path, not a storage concern), but
doing it before H1 shrinks H1's reader count, so the natural order is
**C1 → H1 → this**.

## 3. Target layout

```
<DATA_PATH>/
  settings.json                  # tier-1 config
  registry.json                  # the identity spine
  catalog/
    mal.json                     # MALAnime — pure catalog after H1
    anilist.json                 # AniListMetaEntry: catalog, tags, staff, banner, relations
    anilist_cast.json            # characters + seiyuu; off the hot-path join by design
  personal/
    mal.json                     # MALPersonalEntry — NEW, created by H1
    simkl.json
    anilist.json
    local.json
  user/
    hidden.json
    reco_feedback.json
    reco_dismissed.json          # legacy read-only; still excluded from the feed
  auth/
    mal.json
    simkl.json
    anilist.json
    oauth_state.json             # transient CSRF state, all three providers
  sync/
    mal_seasons.json             # seasonal-crawl checkpoint
    simkl_checkpoint.json        # all-items watermark + lastRatedAt
    anilist_import.json          # last-import count/date
  cache/
    recommendations.json         # rebuildable: crowd/AniList seeds + hydrated candidates
  logs/
    connection_log.json          # the sync-progress feed — app data, not diagnostics
```

**Organized by role, not by provider.** The alternative (`mal/`, `simkl/`,
`anilist/`) was considered and rejected: it files a 39 MB catalog next to an auth
token, splits the four personal slices across three folders, and has no home at
all for `local` or for the registry. Role also mirrors how the code is already
organized (`personalState.ts`, `personalWriters.ts`, personal precedence) and how
[PROVIDER-PARITY.md](PROVIDER-PARITY.md) E4 argues the Connections UI should be
split — *what is my catalog, and which lists am I syncing?*

**Two files stay at the root, for reasons:**

- `settings.json` — tier-1 config, read before the rest of the store exists. It
  is not store data; filing it under a data folder inverts the dependency.
- `registry.json` — the identity spine every other file's keys resolve through.
  It belongs to no role because it is what the roles hang off. Root placement
  states that.

**Names shed their prefixes**, since the folder now carries them:
`personal/mal.json`, not `personal/animes_mal_personal.json`. The same basename
appearing under `catalog/` and `personal/` is the point, not a collision.

### 3.1 Full mapping

| Today | Becomes |
|---|---|
| `settings.json` | *(unchanged)* |
| `animes_registry.json` | `registry.json` |
| `animes_mal.json` | `catalog/mal.json` |
| `animes_anilist_meta.json` | `catalog/anilist.json` |
| `animes_anilist_cast.json` | `catalog/anilist_cast.json` |
| *(created by H1)* | `personal/mal.json` |
| `animes_simkl.json` | `personal/simkl.json` |
| `animes_anilist_personal.json` | `personal/anilist.json` |
| `animes_local_personal.json` | `personal/local.json` |
| `animes_hidden.json` | `user/hidden.json` |
| `recommendations_feedback.json` | `user/reco_feedback.json` |
| `recommendations_dismissed.json` | `user/reco_dismissed.json` |
| `mal_auth.json` | `auth/mal.json` |
| `simkl_auth.json` | `auth/simkl.json` |
| `anilist_auth.json` | `auth/anilist.json` |
| `oauth_state.json`, `simkl_oauth_state.json`, `anilist_oauth_state.json` | `auth/oauth_state.json` |
| `mal_season_checkpoint.json` | `sync/mal_seasons.json` |
| `simkl_sync_checkpoint.json` | `sync/simkl_checkpoint.json` |
| `anilist_personal_config.json` | `sync/anilist_import.json` |
| `recommendations.json` | `cache/recommendations.json` |
| `connection_log.json` | `logs/connection_log.json` (see [§3.2](#32-the-connection-log-is-app-data)) |

Merging the three `oauth_state` files is the one contents change proposed here —
they hold transient per-provider CSRF state, are written and consumed within a
single OAuth round-trip, and a `{provider: state}` map is the same shape three
times over. **Optional**; keep them separate if the merge feels like scope creep,
in which case they become `auth/oauth_state_{mal,simkl,anilist}.json`.

### 3.2 The connection log is app data

`connection_log.json` is named like diagnostics but behaves like a feature: it is
the progress feed the Connections panel and the onboarding progress bar **poll**
(there is no SSE for meta-sync, cast-sweep or the catalog crawl — the log *is* the
transport). It is capped at 500 entries and read by the UI on a timer.

So it belongs to the store, at a fixed `logs/connection_log.json` under
`DATA_PATH` — **not** under `LOGS_PATH`. `LOGS_PATH` stays what its name says: a
folder for debug/error output, independently configurable and free to point at a
volume with a different retention policy.

Today it is the other way round: `connection_log.json` is the *only* consumer of
`LOGS_PATH`, which falls back to the data path
([bootstrap.ts:70](../src/lib/bootstrap.ts)), so a default install drops it in the
middle of the store and a configured `LOGS_PATH` moves a *feature's* data out of
the store.

Two consequences worth stating plainly:

- **`LOGS_PATH` ends up with zero consumers.** It remains a valid, displayed
  setting reserved for real diagnostics, but nothing writes there until something
  does. That is deliberate, not an oversight — better than keeping a feature file
  under a diagnostics path to justify the setting.
- **`connectionLog.ts` gets simpler.** It stops resolving a second root and just
  uses `dataFile('logs/connection_log.json')`. Its existing `LEGACY_LOG_FILE`
  fallback (which already reads the pre-`LOGS_PATH` location) is superseded by the
  migration and can go — with the caveat in [§5.1](#51-code-changes) about installs
  that set `LOGS_PATH` explicitly. The `LOGS_PATH` export moves to the settings
  route, its only other reader.

## 4. The orphan sweep

**Four files are referenced by zero code**, verified by grepping every
`dataFile(...)` call site against the folder contents:

| File | Why it is dead |
|---|---|
| `ratings.json` | The saved-ratings feature, removed in `d40c3d4` |
| `rating_criteria.json` | Same removal |
| `animes_extensions.json` | Already documented as an orphan in [scripts/migrate-canonical.js:26](../scripts/migrate-canonical.js) — *"read by nothing"* |
| `user_preferences.json` | Superseded by `settings.json`'s preferences block |

**Two stale backups** from the canonical-id migration: `animes_simkl.json.bak`
and `animes_simkl.json.bak-premigrate` (see
[docs/provider-free-cutover/migration-findings.md](provider-free-cutover/migration-findings.md)).
That migration is long shipped and verified.

**Not an orphan, despite looking like one:** `recommendations_dismissed.json` is
the legacy pure-hide dismiss list, superseded by 👎 feedback but **still read**
and still excluded from the feed. It keeps its place under `user/`.

**Handling: delete.** The sweep unlinks them. This is safe because of the
[runbook](#52-runbook) rather than because of the grep: the migration runs against
a stopped app, off a backup taken minutes earlier, so "irreversible" means
"restore the backup" and quarantining would just add a folder to clean up later.

The script still **lists what it will delete** and honours `--dry-run`, and the
sweep stays behind its own `--sweep-orphans` flag — deleting is the default
handling, not a default action.

## 5. Migration

Modeled directly on [scripts/migrate-canonical.js](../scripts/migrate-canonical.js),
which set the conventions worth reusing: a dry-run mode, an explicit refusal on
anything unexpected, and idempotency by construction.

```
node scripts/migrate-layout.js <dataPath> [--dry-run] [--sweep-orphans]
```

**Order of operations, per file:** write the new path → verify it parses and
matches → remove the old. A crash mid-run therefore leaves both copies, never
neither.

**Idempotency:** new path exists and old does not → no-op. Both exist → **refuse
and report** (it means a run was interrupted, or the app wrote to the old path
after a partial migration); never last-writer-wins. Neither exists → skip, the
file is simply absent on this install.

**Unknown files:** report them and leave them. A file the script does not
recognize is either a new one this document missed or something the user put
there; both deserve a human.

**The orphan sweep is opt-in** (`--sweep-orphans`) and separate from the move, so
the layout change can ship without touching anything's contents.

### 5.1 Code changes

- **`dataFile()` is the single seam** ([jsonStore.ts:20](../src/lib/jsonStore.ts)) —
  `path.join(DATA_PATH, name)` already handles `'personal/mal.json'` on both
  platforms. Only the ~22 filename constants change.
- **`ensureDataDirectory()` must create the file's parent, not just the root.**
  `writeJsonFile` calls it before every write and it currently `mkdir`s
  `DATA_PATH` only, so the first write to `personal/mal.json` would fail with
  `ENOENT` on a fresh install. This is the one non-mechanical code change and it
  is small: `mkdirSync(path.dirname(filePath), { recursive: true })`.
- **The parse cache keys on absolute path**, so moving a file naturally misses
  the old entry. No cache work needed.
- **Docker needs no change** — `/app/data` is a single volume mount and
  subdirectories live inside it.

### 5.2 Runbook

A **script**, not a startup migration — matching the canonical-id precedent. A
migration that runs inside a container on a NAS is a migration whose output
nobody reads, and this one has a delete step.

The app is down for the whole of it, and old code never sees the new layout:

1. **Back up** the data folder.
2. **Stop** the app.
3. **Run** `node scripts/migrate-layout.js <dataPath> --sweep-orphans`
   (`--dry-run` first — it prints the moves and the deletions).
4. **Deploy** the new image.
5. **Start** the app.

Steps 3 and 4 are ordered but not interlocked, which is the one sharp edge:
**the old image cannot read the new layout, and the new image cannot read the
old one.** A wrong order or a half-finished step 3 shows up as an app that boots
onto an empty store — indistinguishable, at a glance, from data loss.

So the new code should **refuse to start** when it finds a pre-layout store
(flat `animes_*.json` present, no `catalog/`) and say so, rather than falling
through to first-run onboarding on top of a full store. This is cheap: one
existence check at boot, in the same place `resolveDataPath()` is already called.

Because the app is down and the backup is minutes old, rollback is "restore the
backup and redeploy the old image" — which is what makes deleting the orphans
([§4](#4-the-orphan-sweep)) reasonable.

### 5.3 Which copies of the store get migrated

There are several, and they are not rivals — `DATA_PATH` is configuration, and
each copy is a different install:

| Copy | What it is |
|---|---|
| `\\syno\root4\AppData\AnimeTracker\data` | **Production.** The NAS volume the container mounts at `/app/data`. |
| `E:\Workspace\local\AnimeTracker\data` | A **pull of production** for local debugging, refreshed by script. |
| `%APPDATA%\anime-app\data` | The **first-launch default** — whatever a fresh install accumulated before being pointed elsewhere. |

Consequences for the migration:

- **Production is the one that matters**, and it is the one behind a container.
  The script must run against the mounted path — see the Docker note in
  [§6](#6-risks).
- **The debug copy is downstream, so do not migrate it** — re-pull it after
  production has moved. Migrating it separately just creates a second thing that
  can disagree.
- **The refresh script copies files by name** and will need its file list updated
  in the same change, or a post-migration pull silently repopulates the old flat
  names next to the new folders.
- **A dev machine can hold a pre-layout store and a post-layout one at the same
  time**, which is the second argument for the refuse-to-start check in
  [§5.2](#52-runbook): the app should name the layout it found rather than
  quietly reading half a store.

### 5.4 Rollback

Restore the step-1 backup and redeploy the old image. A `--reverse` flag is cheap
(the mapping is mechanical) but is a convenience, not the plan — the backup is.

## 6. Risks

- **A half-migrated store on a running app.** Mitigated by the write-verify-remove
  order and the refuse-on-both rule, but the app should not be serving during the
  run. Same operational note as the canonical-id migration.
- **Docker path confusion.** The script must run against the *mounted* path, not
  a host path that looks like it. Passing `<dataPath>` explicitly (rather than
  relying on env) makes this visible.
- **Migrating a copy instead of the original.** `DATA_PATH` is configuration and
  the store exists in several places ([§5.3](#53-which-copies-of-the-store-get-migrated));
  the debug pull in particular is downstream and must be re-pulled, not migrated.
- **An install with `LOGS_PATH` set outside the data folder** keeps its
  `connection_log.json` there, out of the script's reach. The script takes a
  `<dataPath>` and cannot know about it. Handled by leaving the read fallback in
  `connectionLog.ts` for one release rather than by widening the script's scope —
  losing a capped progress log is the mildest failure in this document.

## 7. Open items

None blocking. Sequenced behind [PROVIDER-PARITY.md](PROVIDER-PARITY.md) H1
([§2](#2-prerequisite-h1)); the questions this document opened on orphan
handling, migration mechanism and log placement are answered in
[§4](#4-the-orphan-sweep), [§5.2](#52-runbook) and
[§3.2](#32-the-connection-log-is-app-data) respectively.

One thing this does not decide: **merging the three `oauth_state` files**
([§3.1](#31-full-mapping)) is still marked optional. It is the only proposed
contents change and can be dropped without affecting anything else here.
