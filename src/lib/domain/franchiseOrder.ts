/**
 * Franchise watch order — turning a connected component into a line you can
 * watch down.
 *
 * `domain/franchise.ts` answers "which titles are the same franchise"; it hands
 * back a component in the CATALOG's order, which is the order the ~25k records
 * happen to sit in and means nothing to a viewer. This module answers the next
 * question — "in what order do I watch them, and where am I in that line" — and
 * is what `/franchise/[id]` renders.
 *
 * Pure and client-safe (no `fs`), same posture as the module it builds on.
 *
 * ## The order is AIR DATE, and that is a claim worth stating
 *
 * Nothing in any provider's payload encodes a *story* order, or a recommended
 * one. Relation edges give a graph, not a sequence: they are undirected here by
 * construction (`groupIntoFranchises` unions both directions), several entries
 * routinely share one parent, and a component of 11 movies has no single chain
 * through it. So the spine is `catalog.startDate`, which is present on **99.1%**
 * of members of a multi-member franchise (measured on the live store, 9,429 of
 * 9,519), and which for the archetypal case — Kara no Kyoukai's 11 entries —
 * reproduces the canonical release order exactly.
 *
 * Where release order and the *recommended* order genuinely differ (Monogatari
 * is the standing example), this is wrong and cannot be made right from the data
 * on hand. The page says so rather than implying an authority it hasn't got.
 * Do NOT "fix" that with a hand-maintained per-franchise order table: there are
 * 2,542 multi-member franchises on this store and no provider to re-supply one.
 *
 * ## Naming: the earliest AIRED member, and the alternatives were measured
 *
 * A franchise has no name of its own anywhere in the store — it is a derived
 * component, which is also why membership is never persisted under a franchise
 * key (see the `/boxes` note in CLAUDE.md). The longest common title prefix was
 * built and measured first, and is rejected: it is empty on 22% of components
 * (490 of 2,542) and truncates mid-name on much of the rest — "Cowboy" for
 * Cowboy Bebop, "Aa" for Aa! Megami-sama!, "Hunter x" for Hunter x Hunter,
 * "Full Metal" for Full Metal Panic!. The earliest aired member is a title that
 * actually exists, and it reads correctly on the cases that matter: "Cowboy
 * Bebop", "Bakemonogatari", "Neon Genesis Evangelion", "Mobile Suit Gundam",
 * "The Garden of Sinners Chapter 1: Overlooking View".
 *
 * WARNING: earliest **aired**, not the component's first element. The catalog
 * order is arbitrary, so reading `members[0]` would name the Gundam franchise
 * after whichever of its 131 entries the crawl happened to land first.
 */
import type { AnimeRecord } from '@/models/anime';
import type { TitleLanguage } from '@/lib/url/viewDefaults';
import {
  getEffectiveStatus,
  getEffectiveScore,
  getEffectiveProgress,
  getPrimaryTitle,
} from '@/lib/domain/animeUtils';

/** One row of the watch line. Lean: the page ships these, never records. */
export interface FranchiseEntry {
  id: string;
  title: string;
  picture?: string;
  /** "YYYY-MM-DD" as the providers store it; absent on 0.9% of members. */
  startDate?: string;
  mediaType?: string;
  /** 'finished_airing' | 'currently_airing' | 'not_yet_aired'. */
  airing?: string;
  numEpisodes?: number;
  mean?: number;
  /** Effective personal state — SIMKL > MAL > AniList > local, via the helpers. */
  status?: string;
  score?: number;
  progress?: number;
  /** 1-based position in the line, so the UI never has to count. */
  position: number;
  /** The entry the page was opened from — the "you are here" mark. */
  isFocus: boolean;
}

export interface FranchiseProgress {
  total: number;
  completed: number;
  /** `watching` + `on_hold` — started, not finished. */
  started: number;
  dropped: number;
  planned: number;
  /** No effective status at all. */
  untouched: number;
  /** Episodes across every entry that has one. */
  episodesTotal: number;
  /**
   * Episodes in aired-but-not-completed entries, minus what you have already
   * watched of them — "how much is left". Entries with no episode count
   * contribute 0 rather than a guess.
   */
  episodesRemaining: number;
}

export interface FranchiseView {
  /** Earliest aired member's title — see the naming note above. */
  name: string;
  entries: FranchiseEntry[];
  progress: FranchiseProgress;
  /**
   * The entry to watch next: the first in air order you have neither completed
   * nor dropped, skipping anything not yet aired. `null` once the line is
   * exhausted — which the page reports as "up to date", a different statement
   * from an empty list.
   */
  nextUpId: string | null;
  /** Members that have not aired yet, counted so a "0 left" never lies. */
  unairedCount: number;
}

/**
 * Air order: earliest first, undated last, title as the tiebreak.
 *
 * WARNING: the undated sentinel is not decoration. `Date.parse(undefined)` is
 * `NaN` and every comparison against `NaN` is false, so a comparator that let
 * one through would return 0 for every pair involving an undated entry —
 * leaving those entries wherever the catalog happened to put them, quite
 * possibly at the head of the line. A watch order that opens on an undated
 * special is wrong in a way nothing on screen would flag. Same guard, same
 * reason, as `/catch-up`'s `byAirDate`.
 */
export function compareByAirDate(
  a: AnimeRecord,
  b: AnimeRecord,
  titleLang: TitleLanguage
): number {
  const ta = a.catalog.startDate ? Date.parse(a.catalog.startDate) : Number.NaN;
  const tb = b.catalog.startDate ? Date.parse(b.catalog.startDate) : Number.NaN;
  const va = Number.isNaN(ta) ? Number.MAX_SAFE_INTEGER : ta;
  const vb = Number.isNaN(tb) ? Number.MAX_SAFE_INTEGER : tb;
  if (va !== vb) return va - vb;
  return getPrimaryTitle(a, titleLang).localeCompare(getPrimaryTitle(b, titleLang));
}

/** A status that means "this one is behind me": no longer the next thing. */
const SETTLED = new Set(['completed', 'dropped']);

/**
 * Build the whole view for one franchise component.
 *
 * `focusId` is the member the page was reached from — it only marks a row, it
 * never changes the order or the name, so two members of the same franchise
 * render the identical line.
 */
export function buildFranchiseView(
  members: AnimeRecord[],
  focusId: string,
  titleLang: TitleLanguage
): FranchiseView {
  const ordered = [...members].sort((a, b) => compareByAirDate(a, b, titleLang));

  const entries: FranchiseEntry[] = ordered.map((m, i) => ({
    id: m.id,
    title: getPrimaryTitle(m, titleLang),
    picture: m.catalog.mainPicture?.medium || m.catalog.mainPicture?.large,
    startDate: m.catalog.startDate,
    mediaType: m.catalog.mediaType,
    airing: m.catalog.airingStatus,
    numEpisodes: m.catalog.numEpisodes,
    mean: m.catalog.mean,
    status: getEffectiveStatus(m) || undefined,
    score: getEffectiveScore(m) || undefined,
    progress: getEffectiveProgress(m) || undefined,
    position: i + 1,
    isFocus: m.id === focusId,
  }));

  const progress: FranchiseProgress = {
    total: entries.length,
    completed: 0,
    started: 0,
    dropped: 0,
    planned: 0,
    untouched: 0,
    episodesTotal: 0,
    episodesRemaining: 0,
  };
  let unairedCount = 0;

  for (const e of entries) {
    const aired = e.airing !== 'not_yet_aired';
    if (!aired) unairedCount++;
    progress.episodesTotal += e.numEpisodes ?? 0;

    switch (e.status) {
      case 'completed': progress.completed++; break;
      case 'watching':
      case 'on_hold': progress.started++; break;
      case 'dropped': progress.dropped++; break;
      case 'plan_to_watch': progress.planned++; break;
      default: progress.untouched++; break;
    }

    // "How much is left" counts only what you could actually watch tonight, and
    // credits the episodes already behind you in a half-finished entry.
    if (aired && e.status !== 'completed') {
      const eps = e.numEpisodes ?? 0;
      progress.episodesRemaining += Math.max(0, eps - Math.min(e.progress ?? 0, eps));
    }
  }

  const next = entries.find(
    e => e.airing !== 'not_yet_aired' && !SETTLED.has(e.status ?? '')
  );

  return {
    // `entries[0]` IS the earliest aired member — the sort put it there, which
    // is the whole reason the name is derived after sorting rather than before.
    name: entries[0]?.title ?? '',
    entries,
    progress,
    nextUpId: next?.id ?? null,
    unairedCount,
  };
}
