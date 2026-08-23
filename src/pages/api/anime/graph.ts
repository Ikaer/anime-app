/**
 * GET /api/anime/graph — one ego neighbourhood behind /graph.
 *
 * Computed here rather than client-side for the reason `/stats` and `/quick-rate`
 * already establish, only more so: the reverse indexes this reads span the whole
 * catalog (49,897 staff people, 2,255 seiyuu) and the latent anime↔anime edge set
 * is 82,196 wide. What crosses the wire is one neighbourhood — a few hundred lean
 * nodes. The index never does.
 *
 * The cast slice is read separately: it is deliberately NOT part of
 * `getAnimeForDisplay()`'s join (see `AniListCastEntry`).
 *
 * Nothing here calls a provider. The graph is entirely a read of the local store,
 * which is what makes it browsable at page speed.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getAllAnilistCast, getAnimeForDisplay } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import {
  computeEgo,
  GRAPH_FOCAL_TYPES,
  type GraphEgo,
  type GraphFilters,
  type GraphFocalType,
} from '@/lib/domain/animeGraph';
import { STAFF_ROLE_TIERS, type StaffRoleTier } from '@/lib/domain/staffRole';

export type GraphApiResponse = GraphEgo;

/** `a,b,c` → `['a','b','c']`. Absent and empty both mean "no filter". */
function csv(value: unknown): string[] {
  return typeof value === 'string'
    ? value.split(',').map(s => s.trim()).filter(Boolean)
    : [];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const typeParam = typeof req.query.type === 'string' ? req.query.type : 'anime';
    if (!GRAPH_FOCAL_TYPES.includes(typeParam as GraphFocalType)) {
      return res.status(400).json({ error: `Unknown focal type: ${typeParam}` });
    }
    const focalType = typeParam as GraphFocalType;

    const focalKey = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!focalKey) return res.status(400).json({ error: 'Missing id' });

    const tiers = csv(req.query.tiers)
      .map(Number)
      .filter((n): n is StaffRoleTier => STAFF_ROLE_TIERS.includes(n as StaffRoleTier));

    const filters: GraphFilters = {
      inList: req.query.inList === '1',
      roles: csv(req.query.roles).map(r => r.toUpperCase()),
      mediaTypes: csv(req.query.mediaTypes),
      tiers,
      tag: typeof req.query.tag === 'string' && req.query.tag.trim() ? req.query.tag.trim() : undefined,
    };

    const ego = computeEgo(focalType, focalKey, getAnimeForDisplay(), getAllAnilistCast(), getTitleLanguage(), filters);
    // A focal node with no credits is indistinguishable from a typo, so this is a
    // 404 rather than an empty graph — see `computeEgo`.
    if (!ego) return res.status(404).json({ error: `No ${focalType} found for ${focalKey}` });

    return res.status(200).json(ego satisfies GraphApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Graph computation error:', error);
    return res.status(500).json({ error: message });
  }
}
