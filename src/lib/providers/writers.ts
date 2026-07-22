/**
 * Personal-state **writer registry** (server-only). The write-side mirror of the
 * read-side per-provider extractors in [personalState.ts](personalState.ts): a
 * rating/status/progress edit fans out to every enabled writable provider and
 * returns a per-provider outcome map.
 *
 * Two phases, in this order:
 *   1. **Local-cache authority writes**, for every enabled writer. These bump
 *      whichever local slice feeds `getEffective*` under the current precedence,
 *      so a subsequent read — or a hung/failed remote — already reflects the edit.
 *   2. **Remote fan-out**, serial (SIMKL holds a 20s per-user write-lock and caps
 *      POSTs at 1 req/s), collecting a `WriteOutcome` per provider.
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
import { updateMalListStatus } from '@/lib/providers/mal/write';
import { pushSimklRating } from '@/lib/providers/simkl/write';
import { pushAnilistEntry } from '@/lib/providers/anilist/write';
import { isPersonalProviderEnabled } from '@/lib/providers/registry';
import { supportsDimension, type PersonalDimension } from '@/lib/providers/capabilities';

/**
 * The provider-neutral edit. `score` 0 clears the rating; `status: null` clears
 * the status.
 *
 * Clearing a status has **no remote equivalent** — MAL models it as a list DELETE
 * (which would also drop the score) and SIMKL is score-only — so the remote
 * writers refuse it explicitly with `ok: false` and a reason. That is distinct
 * from `WriteOutcome.unsupported`: clearing is a *shape* of the `status`
 * dimension both providers do claim, not a dimension they never claimed. The
 * detail-page control only offers "clear" to a local-only user (see
 * `hasWritableExternal`), where there is no remote to diverge from.
 */
export interface PersonalPatch {
  status?: UserAnimeStatus | null;
  score?: number;
  progress?: number;
}

export interface WriteOutcome {
  ok: boolean;
  /** Provider matched the title (SIMKL's `not_found` case). */
  matched?: boolean;
  /**
   * Dimensions of the patch this provider does not implement, and therefore did
   * NOT apply — read off the capability descriptor, never re-derived per writer.
   * SIMKL is the case: score-only, so a status or progress patch is discarded.
   *
   * `ok` stays true, because nothing failed: declining a dimension it never
   * claimed is a **partial** write, and the distinction the UI has to make is
   * *failed* vs *not applicable*.
   */
  unsupported?: PersonalDimension[];
  /** No dimension of the patch applied at all — the write never reached this
   *  provider, locally or remotely. Implies `unsupported` covers the whole patch. */
  skipped?: boolean;
  error?: string;
}

interface WriteContext {
  canonicalId: string;
  /** The assembled record — `undefined` for a title that has no assemblable
   *  row (a true local-only title with no `crosswalk.mal`). */
  record?: AnimeRecord;
}

/**
 * A writer carries no enablement of its own: "is this provider usable right
 * now?" is `isPersonalProviderEnabled` in [registry.ts](registry.ts), the single
 * predicate over the capability descriptors + auth files.
 */
interface PersonalWriter {
  id: ProvenanceSource;
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
// Writes to BOTH the local MAL personal slice (`personal/mal.json`, the
// authority) and the MAL API.
const malWriter: PersonalWriter = {
  id: 'mal',
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
// Score-only, and that is DECLARED (`write: ['score']`) rather than enforced
// here: `writePersonal` narrows the patch to the dimensions the descriptor
// admits, so a status/progress patch never reaches these functions and is
// reported as `unsupported` instead of silently dropped. Bumps the local SIMKL
// entry first — SIMKL-first `getEffectiveScore` needs it — then pushes.
const simklWriter: PersonalWriter = {
  id: 'simkl',
  writeLocal({ canonicalId }, patch) {
    if (patch.score === undefined) return;
    const entries = getAllSimklEntries();
    const entry = entries[canonicalId];
    if (!entry) return; // no local SIMKL entry to bump
    entry.score = patch.score > 0 ? patch.score : null;
    upsertSimklEntries([entry]);
  },
  async writeRemote({ record }, patch) {
    if (patch.score === undefined) return { ok: true, matched: false }; // unreachable: narrowed away
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
// Full status/score/progress writer — `SaveMediaListEntry` is an upsert over all
// three. Keys off the ANILIST media id, not the MAL id (see anilist/write.ts),
// and falls back to a live idMal lookup when the crosswalk has no AniList id.
const anilistWriter: PersonalWriter = {
  id: 'anilist',
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

/** The dimensions this patch actually carries. `status: null` is still a status. */
function patchDimensions(patch: PersonalPatch): PersonalDimension[] {
  const dims: PersonalDimension[] = [];
  if (patch.status !== undefined) dims.push('status');
  if (patch.score !== undefined) dims.push('score');
  if (patch.progress !== undefined) dims.push('progress');
  return dims;
}

/**
 * The slice of a patch one provider will actually apply, per its declared
 * `write` dimensions. Narrowing here — once, from the descriptor — is what keeps
 * a writer from having to know its own capabilities, and what makes the
 * discarded remainder *reportable* instead of vanishing inside the writer.
 */
function narrowPatch(id: ProvenanceSource, patch: PersonalPatch): {
  applied: PersonalPatch;
  unsupported: PersonalDimension[];
} {
  const applied: PersonalPatch = {};
  const unsupported: PersonalDimension[] = [];
  for (const dim of patchDimensions(patch)) {
    if (!supportsDimension(id, dim)) unsupported.push(dim);
    else if (dim === 'status') applied.status = patch.status;
    else if (dim === 'score') applied.score = patch.score;
    else applied.progress = patch.progress;
  }
  return { applied, unsupported };
}

/**
 * Fan a personal-state edit out to every enabled writer. Local-cache authority
 * writes land first (so `getEffective*` reflects the edit immediately), then the
 * remote pushes fire serially. Returns a per-provider outcome map, in which a
 * provider that could only apply part of the patch (or none of it) says so —
 * see `WriteOutcome.unsupported`.
 */
export async function writePersonal(canonicalId: string, patch: PersonalPatch): Promise<WritePersonalResult> {
  const record = getAnimeByCanonicalId(canonicalId);
  const active = REGISTRY.filter(w => isPersonalProviderEnabled(w.id));
  const ctx: WriteContext = { canonicalId, record };

  // A title is "found" if it assembles a row, or the local provider can create
  // one (create-not-just-edit for a MAL-less title).
  const found = record !== undefined || active.some(w => w.id === 'local');
  if (!found) return { found: false, outcomes: {} };

  const narrowed = new Map(active.map(w => [w.id, narrowPatch(w.id, patch)]));
  const applicable = active.filter(w => Object.keys(narrowed.get(w.id)!.applied).length > 0);

  // Pass 1: local-cache authority writes — ALL before any remote.
  for (const w of applicable) w.writeLocal(ctx, narrowed.get(w.id)!.applied);

  // Pass 2: remote fan-out — serial (SIMKL's per-user write-lock / 1 req/s cap).
  const outcomes: Partial<Record<ProvenanceSource, WriteOutcome>> = {};
  for (const w of active) {
    const { applied, unsupported } = narrowed.get(w.id)!;
    // Wholly inapplicable: reported, never attempted — e.g. a status-only edit
    // against score-only SIMKL.
    if (Object.keys(applied).length === 0) {
      outcomes[w.id] = { ok: true, matched: false, skipped: true, unsupported };
      continue;
    }
    const outcome = await w.writeRemote(ctx, applied);
    outcomes[w.id] = unsupported.length > 0 ? { ...outcome, unsupported } : outcome;
  }

  return { found: true, outcomes };
}
