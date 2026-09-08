import type { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import { getFranchiseIndex } from '@/lib/domain/franchise';
import { getTitleLanguage } from '@/lib/config/settings';
import { toLeanRow, byAirDate, type LeanAnimeRow } from '@/lib/domain/leanRow';

/**
 * GET /api/anime/franchise-component?id=a_123 — what the group blade opens on.
 *
 * The provider relation component a title belongs to, in airing order, plus the
 * name the blade pre-fills. ⚠️ **A suggestion, never an authority** (§4): the
 * blade seeds from this with every entry checked, and the owner carves out what
 * does not belong. That is the whole content of « on my terms » — the relation
 * graph proposes, `user/groups.json` decides.
 *
 * Three things it deliberately does NOT do:
 *
 * - **It does not filter by status.** Unwatched entries stay listable and
 *   checkable (§4): they are inert until one is filed, and then it arrives
 *   already grouped. This is the opposite rule from `watched`, whose
 *   scope is what you can label.
 * - **It does not say which groups a member is already in.** The blade already
 *   holds every group's full `members` array from `GET /api/anime/groups`, so
 *   labelling an overlap is a client-side set test — and asking the server would
 *   make this route go stale the moment a group is edited beside it.
 * - **It does not create anything.** A group is minted by `POST /api/anime/groups`
 *   with whatever survived the carve.
 *
 * ⚠️ Scope is `direct` (sequel/prequel), the scope every box-side surface uses.
 * The wider one chains Gundam SEED, 00, Iron-Blooded Orphans and Witch from
 * Mercury into ONE 129-entry component — and a group seeded from that, declared
 * in a box, would collapse four unrelated shows into a single vote.
 *
 * A title the relation graph connects to nothing answers with itself, not 404:
 * a standalone title is allowed to start a group (§4).
 */

export interface FranchiseComponentResponse {
  /** The title asked about — the blade marks it, since it is the one you clicked. */
  id: string;
  /**
   * Pre-filled group name: the component's earliest AIRED member.
   *
   * `franchiseOrder.ts`' rule, and for its measured reason — naming after the
   * catalog's first member titles the Gundam component after whichever of its
   * 131 entries the crawl landed first, and the longest-common-prefix
   * alternative was measured worse still (empty on 22% of components,
   * truncating to "Cowboy" and "Hunter x" on much of the rest).
   */
  name: string;
  /** The component in airing order. Includes unwatched entries, on purpose. */
  entries: LeanAnimeRow[];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { id } = req.query;
  const animeId = typeof id === 'string' ? id : '';
  if (!animeId) return res.status(400).json({ error: 'id is required' });

  try {
    const all = getAnimeForDisplay();
    const titleLang = getTitleLanguage();
    const anime = all.find(a => a.id === animeId);
    if (!anime) return res.status(404).json({ error: 'Anime not found' });

    const component = getFranchiseIndex(all, 'direct').get(animeId) ?? [anime];
    const ordered = [...component].sort(byAirDate(titleLang));

    return res.status(200).json({
      id: animeId,
      // Read off `ordered[0]`, never `component[0]`: the index hands back catalog
      // order, so the name has to be taken AFTER the air-date sort.
      name: toLeanRow(ordered[0], titleLang).title,
      entries: ordered.map(a => toLeanRow(a, titleLang)),
    } satisfies FranchiseComponentResponse);
  } catch (error) {
    console.error(`Error building franchise component for ${animeId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
