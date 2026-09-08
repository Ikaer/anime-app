import type { NextApiRequest, NextApiResponse } from 'next';
import { getGroup, updateGroup, deleteGroup, editGroupMembers } from '@/lib/reco/groups';
import { getAnimeForDisplay, isCanonicalId } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import { projectGroup } from '@/lib/domain/groupSummary';
import { toLeanRow, byAirDate } from '@/lib/domain/leanRow';
import type { AnimeRecord } from '@/models/anime';

/**
 * One « regroupement ».
 *   GET                            — the group, resolved (the blade's initial state)
 *   PATCH  { name? }               — rename; the id never moves
 *   PUT    { members } | { add?, remove? } — membership
 *   DELETE                         — drop the definition
 *
 * ⚠️ `add`/`remove` exist for `boxes/[id]`' race argument: the blade fires one
 * write per checkbox against a list the server also holds, so a client-side
 * read-modify-write would let the second click clobber the first. `members`
 * stays for the blade's "save this exact carve" action.
 *
 * ⚠️ **DELETE deliberately leaves `Box.groups` alone.** A declaration naming a
 * deleted group is a no-op by construction (`resolveBoxUnits` ignores an id it
 * cannot resolve), so sweeping every box here would rewrite the one file in this
 * app that no provider can re-supply, to achieve nothing.
 */

const idList = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  if (!v.every(x => typeof x === 'string' && isCanonicalId(x))) return null;
  return v as string[];
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const groupId = typeof id === 'string' ? id : '';
  if (!groupId) return res.status(400).json({ error: 'Invalid group id' });

  try {
    const group = getGroup(groupId);
    if (!group) return res.status(404).json({ error: 'Group not found' });

    switch (req.method) {
      case 'GET': {
        const titleLang = getTitleLanguage();
        const byId = new Map<string, AnimeRecord>(getAnimeForDisplay().map(a => [a.id, a]));
        // ⚠️ Full `rows` alongside the projection's 5-row `preview`, because
        // this is the BLADE's read and the blade edits every member. The index
        // keeps the slice — a group can be 130 entries and the index renders a
        // card per group, not a filmography.
        const rows = group.members
          .map(id => byId.get(id))
          .filter((a): a is AnimeRecord => !!a)
          .sort(byAirDate(titleLang))
          .map(a => toLeanRow(a, titleLang));
        return res.status(200).json({ group: projectGroup(group, byId, titleLang), rows });
      }

      case 'PATCH': {
        if (typeof req.body?.name !== 'string') {
          return res.status(400).json({ error: 'name must be a string' });
        }
        return res.status(200).json({ group: updateGroup(groupId, { name: req.body.name }) });
      }

      case 'PUT': {
        if (req.body?.members !== undefined) {
          const members = idList(req.body.members);
          if (!members) return res.status(400).json({ error: 'members must be an array of canonical ids' });
          return res.status(200).json({ group: updateGroup(groupId, { members }) });
        }
        const add = req.body?.add === undefined ? [] : idList(req.body.add);
        const remove = req.body?.remove === undefined ? [] : idList(req.body.remove);
        if (!add || !remove) {
          return res.status(400).json({ error: 'add/remove must be arrays of canonical ids' });
        }
        if (add.length === 0 && remove.length === 0) {
          return res.status(400).json({ error: 'nothing to do: pass members, add or remove' });
        }
        return res.status(200).json({ group: editGroupMembers(groupId, add, remove) });
      }

      case 'DELETE':
        deleteGroup(groupId);
        return res.status(200).json({ message: 'Group deleted' });

      default:
        res.setHeader('Allow', ['GET', 'PATCH', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error handling group ${groupId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
