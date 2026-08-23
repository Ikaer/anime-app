/**
 * GET /api/anime/activity — what you have actually been watching, newest first.
 *
 * The clock is `personal/simkl.json`'s `watched_at` (SIMKL's `last_watched`),
 * and it is the ONLY usable one in the store — the same finding the reco
 * backtest harness rests on, re-measured when this page was built:
 *
 * | source  | date field   | live store            |
 * |---------|--------------|-----------------------|
 * | simkl   | `watched_at` | 650 / 691 entries     |
 * | mal     | `updated_at` | 712, but 114 distinct days and 183 on one |
 * | anilist | —            | 0 entries carry a date |
 * | local   | `updated_at` | an edit mtime, not a watch date |
 *
 * MAL's is a bulk-sync artefact, not a history; AniList's import carries no
 * date at all; and `LocalPersonalEntry.updated_at` records when the row was
 * *edited*, which is a different question. So this endpoint is deliberately
 * SIMKL-only, and says so via `available` rather than rendering an empty page
 * that looks broken — same "declare the degraded mode" posture as
 * `RecoRefreshSources` (B4).
 *
 * ⚠️ **`watched_at` advances per EPISODE, not per completion.** Measured: the
 * most recent entries are `watching` at partial progress. That is what makes
 * this a feed rather than a completion log — and it is also the ceiling, since
 * SIMKL gives exactly ONE timestamp per title. This can say "you last watched
 * Slime S4 on the 21st at 19/24"; it can never say which day episode 18 was.
 * A real per-episode log would need SIMKL's activity endpoint captured on every
 * sync, which is a different project.
 *
 * No separate slice read: the SIMKL entry is already on the joined record as
 * `sources.simkl`, so this rides `getAnimeForDisplay()`'s cache like every
 * other reader.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import {
  applyNarrowingFilters,
  getEffectiveScore,
  getEffectiveStatus,
  getPrimaryTitle,
} from '@/lib/domain/animeUtils';
import { getTitleLanguage } from '@/lib/config/settings';
import type { AnimeRecord } from '@/models/anime';
import type { TitleLanguage } from '@/lib/url/viewDefaults';

/** Everything one feed row needs, and nothing else. */
export interface ActivityEntry {
  id: string;
  title: string;
  picture?: string;
  /** ISO instant from SIMKL's `last_watched`. Grouped into days by the CLIENT. */
  watchedAt: string;
  /** Effective personal status at read time — today's, not the status then. */
  status?: string;
  score?: number;
  /** SIMKL's own progress pair; `total` is SIMKL's count, which can differ from MAL's. */
  progress?: number;
  totalEpisodes?: number;
  mean?: number;
  year?: number;
  mediaType?: string;
}

export interface ActivityResponse {
  entries: ActivityEntry[];
  /** Rows matching the filters, before paging. */
  total: number;
  page: number;
  totalPages: number;
  /**
   * Titles that have a personal status but NO watch date, after the same
   * filters. Reported so the feed's count never silently implies these do not
   * exist — on the live store they are the 33 `plan_to_watch` entries (nothing
   * watched, correctly dateless) plus a handful of `dropped` ones.
   */
  undated: number;
  /**
   * False when nothing in the store supplies a watch clock at all — i.e. no
   * SIMKL account. Distinguishes "no history yet" from "this install cannot
   * have a history", which the page renders differently.
   */
  available: boolean;
}

const PAGE_SIZE = 60;

function toEntry(a: AnimeRecord, watchedAt: string, titleLang: TitleLanguage): ActivityEntry {
  const simkl = a.sources.simkl;
  return {
    id: a.id,
    title: getPrimaryTitle(a, titleLang),
    picture: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
    watchedAt,
    status: getEffectiveStatus(a),
    score: getEffectiveScore(a) ?? undefined,
    progress: simkl?.num_episodes_watched ?? undefined,
    totalEpisodes: simkl?.total_episodes ?? a.catalog.numEpisodes,
    mean: a.catalog.mean,
    year: a.catalog.startSeason?.year,
    mediaType: a.catalog.mediaType,
  };
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const q = req.query;
    const str = (v: string | string[] | undefined): string =>
      (typeof v === 'string' ? v : '').trim();
    const csv = (v: string | string[] | undefined): string[] =>
      str(v).split(',').map(s => s.trim()).filter(Boolean);
    const num = (v: string | string[] | undefined): number | null => {
      const s = str(v);
      if (!s) return null;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };

    const all = getAnimeForDisplay();

    // Scope is the personal list, not the catalog: a row exists only where the
    // user has a status. Hidden titles stay hidden here as everywhere.
    const statused = all.filter(a => !a.hidden && getEffectiveStatus(a));

    const wantedStatuses = csv(q.status);
    const byStatus = wantedStatuses.length > 0
      ? statused.filter(a => wantedStatuses.includes(getEffectiveStatus(a) || ''))
      : statused;

    // The same shared narrowing implementation every other surface uses, so
    // there is one filter behaviour rather than a second one that drifts.
    const filtered = applyNarrowingFilters(byStatus, {
      search: str(q.search),
      mediaTypes: csv(q.mediaType),
      minScore: num(q.minScore),
      maxScore: num(q.maxScore),
      minYear: num(q.minYear),
      maxYear: num(q.maxYear),
      genres: csv(q.genres),
    });

    const dated: { record: AnimeRecord; watchedAt: string }[] = [];
    let undated = 0;
    for (const a of filtered) {
      const watchedAt = a.sources.simkl?.watched_at;
      if (watchedAt) dated.push({ record: a, watchedAt });
      else undated++;
    }

    // `available` asks whether the STORE has a clock, so it is measured before
    // the filters — otherwise a narrow filter would misreport a SIMKL install as
    // having no watch history at all.
    const available = all.some(a => !!a.sources.simkl?.watched_at);

    dated.sort((x, y) => y.watchedAt.localeCompare(x.watchedAt));

    const total = dated.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(0, Math.floor(num(q.page) ?? 0)), totalPages - 1);
    const slice = dated.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    const titleLang = getTitleLanguage();
    const body: ActivityResponse = {
      entries: slice.map(d => toEntry(d.record, d.watchedAt, titleLang)),
      total,
      page,
      totalPages,
      undated,
      available,
    };
    res.status(200).json(body);
  } catch (error) {
    console.error('Activity feed error:', error);
    res.status(500).json({ error: 'Failed to build the activity feed' });
  }
}
