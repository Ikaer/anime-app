/**
 * Pure MAL<->SIMKL comparison helpers. Client-safe: no fs/path imports, so this
 * module is importable from both API handlers and React components.
 */
import { MALAnime, SimklPersonalEntry, Discrepancy, UserAnimeStatus } from '@/models/anime';

// SIMKL status vocabulary -> MAL vocabulary. Returns null for unknown values.
const SIMKL_STATUS_MAP: Record<string, UserAnimeStatus> = {
  watching: 'watching',
  completed: 'completed',
  hold: 'on_hold',
  plantowatch: 'plan_to_watch',
  dropped: 'dropped',
  // tolerate already-normalized / alternate spellings
  on_hold: 'on_hold',
  plan_to_watch: 'plan_to_watch',
  notinteresting: 'dropped',
};

export function mapSimklStatus(raw: string | undefined | null): UserAnimeStatus | null {
  if (!raw) return null;
  return SIMKL_STATUS_MAP[raw.toLowerCase().trim()] ?? null;
}

/**
 * Compute the MAL vs SIMKL discrepancy for a single anime.
 * Returns null when there is no SIMKL entry, or when every comparable
 * dimension agrees. Missing/null values are treated leniently: a value only
 * counts as a mismatch when BOTH sides are present and differ. `presence`
 * flags the soft case where exactly one side carries a status.
 */
export function computeDiscrepancy(
  anime: MALAnime,
  simkl?: SimklPersonalEntry
): Discrepancy | null {
  if (!simkl) return null;

  const malStatus = anime.my_list_status?.status
    ? (anime.my_list_status.status as UserAnimeStatus)
    : null;
  const malScore = anime.my_list_status?.score ? anime.my_list_status.score : null;
  const malProgress =
    anime.my_list_status?.num_episodes_watched != null
      ? anime.my_list_status.num_episodes_watched
      : null;

  const result: Discrepancy = {};

  // Status
  if (malStatus && simkl.status && malStatus !== simkl.status) {
    result.status = { mal: malStatus, simkl: simkl.status };
  }

  // Score (both present and differing)
  if (malScore != null && simkl.score != null && malScore !== simkl.score) {
    result.score = { mal: malScore, simkl: simkl.score };
  }

  // Progress (both present and differing)
  if (
    malProgress != null &&
    simkl.num_episodes_watched != null &&
    malProgress !== simkl.num_episodes_watched
  ) {
    result.progress = { mal: malProgress, simkl: simkl.num_episodes_watched };
  }

  // Presence (soft): synced from SIMKL but not statused on MAL. The inverse
  // (on MAL, not on SIMKL) is intentionally NOT computed here — this function
  // only runs when a SIMKL entry exists, and every stored entry has a status.
  if (!malStatus) {
    result.presence = 'simkl_only';
  }

  const hasAny =
    result.status || result.score || result.progress || result.presence;
  return hasAny ? result : null;
}
