import type { NextApiRequest, NextApiResponse } from 'next';
import { getGroups, createGroup } from '@/lib/reco/groups';
import { getBoxes } from '@/lib/reco/boxes';
import { getAnimeForDisplay, isCanonicalId } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import { projectGroup, type GroupSummary } from '@/lib/domain/groupSummary';
import type { AnimeRecord } from '@/models/anime';

/**
 * « Mes regroupements » — the global definitions.
 *   GET  — every group, with a few resolved rows so a card has a face
 *   POST { name, members? } — create one
 *
 * Unlike `/api/anime/boxes`, this ships a small `preview` slice rather than only
 * ids: a group's whole job is to say "these titles are one thing", so a list of
 * bare ids is unreadable, and the blade and the sidebar index both need posters.
 * It stays a slice rather than the full membership for the reason every
 * group-oriented route here projects server-side — a group can hold 130 entries
 * (the wide-scope Gundam component), and the index renders a card, not a list.
 */

export interface GroupListResponse {
  groups: GroupSummary[];
}

const idList = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  if (!v.every(x => typeof x === 'string' && isCanonicalId(x))) return null;
  return v as string[];
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const titleLang = getTitleLanguage();
        const byId = new Map<string, AnimeRecord>(getAnimeForDisplay().map(a => [a.id, a]));
        const groups = getGroups().map(g => projectGroup(g, byId, titleLang));
        return res.status(200).json({ groups } satisfies GroupListResponse);
      }

      case 'POST': {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) return res.status(400).json({ error: 'name is required' });
        // Members are optional: the blade can create an empty group and fill it,
        // and a standalone title with no relation component is allowed to start one.
        const members = req.body?.members === undefined ? [] : idList(req.body.members);
        if (!members) return res.status(400).json({ error: 'members must be an array of canonical ids' });
        // `getBoxes()` so the mint never re-issues a dead id a box still declares.
        return res.status(201).json({ group: createGroup(name, members, getBoxes()) });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('Error handling groups request:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
