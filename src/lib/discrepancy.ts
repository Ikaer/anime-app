/**
 * Pure N-provider personal-state comparison. Client-safe: no fs/path imports, so
 * this module is importable from both API handlers and React components.
 *
 * The comparison takes a per-provider map, so a provider joins by adding one row
 * to the extractor table in [personalState.ts](personalState.ts), never by
 * touching this logic. That module — not this one — decides WHICH providers are
 * in the map; this one only compares what it is handed.
 */
import { Discrepancy, ProviderPersonalState, ProvenanceSource, UserAnimeStatus } from '@/models/anime';

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
 * The provider a title is expected to reach. Presence is deliberately
 * **asymmetric**: MAL is the comprehensive list, while SIMKL / local are subset
 * feeds, so "on SIMKL but not on MAL" is news and the inverse is not. A
 * symmetric rule would flag every MAL-only title — i.e. the entire list.
 * Extend this set when a second full-list writable provider lands (Betaseries).
 */
const PRESENCE_ANCHORS: ProvenanceSource[] = ['mal'];

/** Distinct defined values across the present providers, in provider order. */
function distinct<T>(values: T[]): T[] {
  return values.filter((v, i) => values.indexOf(v) === i);
}

/**
 * Compute the cross-provider discrepancy for a single title.
 *
 * Returns null when fewer than two providers hold an entry, or when every
 * comparable dimension agrees. Missing values stay lenient, exactly as the
 * pairwise version was: a dimension only counts as a disagreement when at least
 * two providers define it and the defined values differ.
 */
export function computeDiscrepancy(
  states: Partial<Record<ProvenanceSource, ProviderPersonalState>>
): Discrepancy | null {
  const entries = (Object.entries(states) as [ProvenanceSource, ProviderPersonalState][])
    .filter(([, s]) => s.present);
  if (entries.length === 0) return null;

  const statuses = entries.map(([, s]) => s.status).filter((v): v is UserAnimeStatus => !!v);
  const scores = entries.map(([, s]) => s.score).filter((v): v is number => v != null && v > 0);
  const progresses = entries.map(([, s]) => s.progress).filter((v): v is number => v != null);

  // Progress exception: when providers disagree on the *total* episode count but
  // each has watched all of its own episodes, the title is fully watched
  // everywhere — that's not a real discrepancy (e.g. 12 eps on MAL vs 13 on
  // SIMKL, both completed) and it would be impossible to reconcile.
  //
  // A provider counts as fully-watched if EITHER:
  //  - its status is `completed` — a completed title is watched in full whatever
  //    its episode count. This is load-bearing now that each provider borrows
  //    its OWN catalog's episode total (H1): AniList's catalog count is often
  //    unknown, and without this clause an unknown total would resurface a raw
  //    progress difference between two *completed* entries (MAL 1/1 vs AniList
  //    24/?) as a phantom disagreement.
  //  - it watched `>= total`. `>=`, not `===`: watching past the total (a
  //    provider whose real count exceeds the borrowed one) is never itself a
  //    progress disagreement.
  const allFullyWatched = entries
    .filter(([, s]) => s.progress != null)
    .every(
      ([, s]) =>
        s.status === 'completed' || (s.total != null && s.total > 0 && s.progress! >= s.total)
    );

  const disagree = {
    status: distinct(statuses).length > 1,
    score: distinct(scores).length > 1,
    progress: distinct(progresses).length > 1 && !allFullyWatched,
  };

  // Presence split (soft): the title reached some providers but not the anchor.
  const absentAnchors = PRESENCE_ANCHORS.filter(p => states[p] && !states[p]!.present);
  const presence =
    absentAnchors.length > 0
      ? { present: entries.map(([p]) => p), absent: absentAnchors }
      : undefined;

  if (!disagree.status && !disagree.score && !disagree.progress && !presence) return null;
  return { providers: states, disagree, presence };
}
