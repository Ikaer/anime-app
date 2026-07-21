/**
 * Personal-state **writer registry** (server-only, docs/localRating/ phase 2).
 *
 * The write-side mirror of the read-side per-provider *extractors* in
 * [personalState.ts](personalState.ts). A rating/status/progress edit
 * fans out to every enabled writable provider — MAL, SIMKL, and the in-app
 * `local` slice — and returns a per-provider outcome map. Adding a writable
 * provider (Betaseries, a future AniList OAuth) is a one-line registry entry:
 * the endpoints never change.
 *
 * Two-phase by design (keyed on **capability, not identity**):
 *   1. **Local-cache authority writes** run FIRST, for every enabled writer —
 *      these bump whichever local slice feeds `getEffective*` under the current
 *      precedence (local MAL `my_list_status`, local SIMKL entry, the local
 *      slice). So a subsequent read (or a hung/failed remote) already reflects
 *      the edit. This is why the MAL user, with the local provider OFF, still
 *      gets their local MAL + local SIMKL slices bumped exactly as before.
 *   2. **Remote fan-out** runs second, serial (SIMKL's 20s per-user write-lock
 *      + 1 req/s POST cap), collecting a `WriteOutcome` per provider.
 */
import type {
  AnimeRecord,
  AniListPersonalEntry,
  LocalPersonalEntry,
  MALPersonalEntry,
  ProvenanceSource,
  UserAnimeStatus,
} from '@/models/anime';
import {
  getAllAnime,
  getAllMalPersonal,
  upsertMalPersonal,
  getAllSimklEntries,
  upsertSimklEntries,
  getAllLocalEntries,
  upsertLocalEntries,
  upsertAnilistPersonalEntries,
  getAnimeByCanonicalId,
} from '@/lib/store';
import { updateMalListStatus } from '@/lib/malWrite';
import { pushSimklRating } from '@/lib/simklWrite';
import { pushAnilistEntry } from '@/lib/anilistWrite';
import { getMALAuthData } from '@/lib/mal';
import { getSimklAuthData } from '@/lib/simkl';
import { getAnilistAuthData } from '@/lib/anilistAuth';
import { isLocalProviderEnabled } from '@/lib/providers';

/**
 * The provider-neutral edit. `score` 0 clears the rating; `status: null` clears
 * the status. Clearing a status has **no remote equivalent** — MAL models it as
 * a list DELETE (which would also drop the score) and SIMKL is score-only — so
 * the remote writers report it as unsupported rather than half-applying it. The
 * detail-page control therefore only offers "clear" to a local-only user (see
 * `hasWritableExternal`), where there is no remote to diverge from.
 */
export interface PersonalPatch {
  status?: UserAnimeStatus | null;
  score?: number;
  progress?: number;
}

export interface WriteOutcome {
  ok: boolean;
  /** Provider matched the title (SIMKL's `not_found` case; score-only no-ops). */
  matched?: boolean;
  error?: string;
}

interface WriteContext {
  canonicalId: string;
  /** The assembled record — `undefined` for a title that has no assemblable
   *  row (a true local-only title with no crosswalk.mal; phase 3/quickRate). */
  record?: AnimeRecord;
}

interface PersonalWriter {
  id: ProvenanceSource;
  /** Usable right now (token present / local enabled). */
  isEnabled(): boolean;
  /** Authority write into the local cache slice — sync, cannot fail on network. */
  writeLocal(ctx: WriteContext, patch: PersonalPatch): void;
  /** Remote push. Local writer is a no-op ({ ok: true }). */
  writeRemote(ctx: WriteContext, patch: PersonalPatch): Promise<WriteOutcome>;
}

/** The real MAL id for a record, coerced (crosswalk may carry it as a string). */
function malIdOf(record?: AnimeRecord): number | undefined {
  const raw = record?.crosswalk.mal ?? record?.sources.mal?.id;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// ── MAL ──────────────────────────────────────────────────────────────────────
// Writes to BOTH the local MAL personal slice (`personal/mal.json`,
// authority — H1 split it out of the 39 MB catalog) and the MAL API.
// isEnabled by token PRESENCE (not validity): an expired-but-refreshable token
// still means "this is a MAL user", so we keep bumping the local slice as today.
const malWriter: PersonalWriter = {
  id: 'mal',
  isEnabled: () => getMALAuthData().token != null,
  writeLocal({ canonicalId }, patch) {
    // Only titles the MAL catalog holds get a MAL personal entry — a MAL-less
    // title has no business in the MAL slice (the local writer covers it).
    if (!getAllAnime()[canonicalId]) return;
    const existing = getAllMalPersonal()[canonicalId];
    const entry: MALPersonalEntry = existing
      ? { ...existing }
      : { status: '', score: 0, num_episodes_watched: 0, is_rewatching: false, updated_at: '' };
    if (patch.status !== undefined) entry.status = patch.status ?? '';
    if (patch.score !== undefined) entry.score = patch.score;
    if (patch.progress !== undefined) entry.num_episodes_watched = patch.progress;
    entry.updated_at = new Date().toISOString();
    upsertMalPersonal({ [canonicalId]: entry });
  },
  async writeRemote({ record }, patch) {
    if (patch.status === null) return { ok: false, error: 'MAL cannot clear a status (list removal only)' };
    const malId = malIdOf(record);
    if (malId === undefined) return { ok: false, error: 'No MAL id for this title' };
    try {
      await updateMalListStatus(malId, {
        status: patch.status,
        score: patch.score,
        num_episodes_watched: patch.progress,
      });
      return { ok: true, matched: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'MAL write failed';
      console.error(`[personalWriters] MAL write failed for ${malId}:`, e);
      return { ok: false, error };
    }
  },
};

// ── SIMKL ────────────────────────────────────────────────────────────────────
// Score-only (the one narrow write carve-out — see CLAUDE.md). A status/progress
// patch is a no-op for SIMKL. Bumps the LOCAL SIMKL entry (score) when one
// exists — SIMKL-first `getEffectiveScore` needs it — then pushes to SIMKL.
const simklWriter: PersonalWriter = {
  id: 'simkl',
  isEnabled: () => getSimklAuthData().token != null,
  writeLocal({ canonicalId }, patch) {
    if (patch.score === undefined) return; // score-only source
    const entries = getAllSimklEntries();
    const entry = entries[canonicalId];
    if (!entry) return; // no local SIMKL entry to bump
    entry.score = patch.score > 0 ? patch.score : null;
    upsertSimklEntries([entry]);
  },
  async writeRemote({ record }, patch) {
    if (patch.score === undefined) return { ok: true, matched: false }; // score-only no-op
    const malId = malIdOf(record);
    if (malId === undefined) return { ok: false, error: 'No MAL id for this title' };
    const result = await pushSimklRating(malId, patch.score, {
      simklId: record?.sources.simkl?.simkl_id,
      mediaType: record?.catalog.mediaType,
    });
    return { ok: result.ok, matched: result.matched, error: result.error };
  },
};

// ── AniList ──────────────────────────────────────────────────────────────────
// Full status/score/progress writer (docs/ANILIST-OAUTH.md) — unlike SIMKL's
// score-only carve-out, `SaveMediaListEntry` is an upsert over all three. Keys
// off the ANILIST media id, not the MAL id (see anilistWrite.ts), and falls back
// to a live idMal lookup when the crosswalk has no AniList id yet.
const anilistWriter: PersonalWriter = {
  id: 'anilist',
  isEnabled: () => getAnilistAuthData().token != null,
  writeLocal({ canonicalId, record }, patch) {
    const existing = record?.sources.anilistPersonal;
    // The slice is keyed on the AniList media id; with no existing entry and no
    // crosswalk id there's nothing well-formed to write, so skip the local
    // reflection and let the remote push (which resolves the id live) carry it.
    const anilistId = Number(existing?.anilist_id ?? record?.crosswalk.anilist);
    if (!Number.isFinite(anilistId) || anilistId <= 0) return;

    const next: AniListPersonalEntry = { ...existing, anilist_id: anilistId };
    if (patch.status !== undefined) next.status = patch.status ?? undefined;
    if (patch.score !== undefined) next.score = patch.score > 0 ? patch.score : undefined;
    if (patch.progress !== undefined) next.progress = patch.progress;
    upsertAnilistPersonalEntries({ [canonicalId]: next });
  },
  async writeRemote({ record }, patch) {
    return pushAnilistEntry(patch, {
      anilistId: record?.crosswalk.anilist ?? record?.sources.anilistPersonal?.anilist_id,
      malId: malIdOf(record),
    });
  },
};

// ── Local ────────────────────────────────────────────────────────────────────
// The write of last resort: an in-app slice, no external service. Merges the
// patch onto any existing entry (a score-only edit must not wipe status/progress
// — `upsertLocalEntries` replaces per key), and CREATES when none exists (a
// local-only title has no MAL slice). Always stamps `updated_at`.
const localWriter: PersonalWriter = {
  id: 'local',
  isEnabled: () => isLocalProviderEnabled(),
  writeLocal({ canonicalId }, patch) {
    const existing = getAllLocalEntries()[canonicalId];
    const next: LocalPersonalEntry = {
      ...existing,
      updated_at: new Date().toISOString(),
    };
    if (patch.status !== undefined) next.status = patch.status ?? undefined;
    if (patch.score !== undefined) next.score = patch.score > 0 ? patch.score : undefined;
    if (patch.progress !== undefined) next.progress = patch.progress;
    upsertLocalEntries({ [canonicalId]: next });
  },
  async writeRemote() {
    return { ok: true }; // no remote — the local slice IS the store
  },
};

const REGISTRY: readonly PersonalWriter[] = [malWriter, simklWriter, anilistWriter, localWriter];

export interface WritePersonalResult {
  /** Whether the title exists to be written (drives the endpoint's 404). */
  found: boolean;
  outcomes: Partial<Record<ProvenanceSource, WriteOutcome>>;
}

/**
 * Fan a personal-state edit out to every enabled writer. Local-cache authority
 * writes land first (so `getEffective*` reflects the edit immediately), then the
 * remote pushes fire serially. Returns a per-provider outcome map.
 */
export async function writePersonal(canonicalId: string, patch: PersonalPatch): Promise<WritePersonalResult> {
  const record = getAnimeByCanonicalId(canonicalId);
  const active = REGISTRY.filter(w => w.isEnabled());
  const ctx: WriteContext = { canonicalId, record };

  // A title is "found" if it assembles a row, or the local provider can create
  // one (create-not-just-edit for a MAL-less title).
  const found = record !== undefined || active.some(w => w.id === 'local');
  if (!found) return { found: false, outcomes: {} };

  // Pass 1: local-cache authority writes — ALL before any remote.
  for (const w of active) w.writeLocal(ctx, patch);

  // Pass 2: remote fan-out — serial (SIMKL's per-user write-lock / 1 req/s cap).
  const outcomes: Partial<Record<ProvenanceSource, WriteOutcome>> = {};
  for (const w of active) outcomes[w.id] = await w.writeRemote(ctx, patch);

  return { found: true, outcomes };
}
