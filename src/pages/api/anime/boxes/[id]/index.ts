import type { NextApiRequest, NextApiResponse } from 'next';
import { getBox, updateBox, deleteBox, setBoxMembers } from '@/lib/reco/boxes';
import { isCanonicalId } from '@/lib/store';

/**
 * One box.
 *   PATCH  { name?, emoji? }                  — rename / re-emoji (the id never moves)
 *   PUT    { members } | { add?, remove? }    — membership
 *   DELETE                                    — drop the box
 *
 * ⚠️ **`add`/`remove` exist because the chip rows would otherwise race.** The
 * browse grid renders many cards against many boxes, and a full-replacement
 * `members` write is a read-modify-write on the client: two toggles fired before
 * the first response lands would make the second clobber the first. The
 * incremental form is applied server-side against the current file, so it can't.
 * `members` stays for the audit view, which genuinely does mean "this exact set".
 */

const idList = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  if (!v.every(x => typeof x === 'string' && isCanonicalId(x))) return null;
  return v as string[];
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const boxId = typeof id === 'string' ? id : '';
  if (!boxId) return res.status(400).json({ error: 'Invalid box id' });

  try {
    const box = getBox(boxId);
    if (!box) return res.status(404).json({ error: 'Box not found' });

    switch (req.method) {
      case 'PATCH': {
        const patch: { name?: string; emoji?: string | null } = {};
        if (typeof req.body?.name === 'string') patch.name = req.body.name;
        // `null` clears the emoji; `undefined` leaves it alone.
        if (req.body?.emoji === null || typeof req.body?.emoji === 'string') patch.emoji = req.body.emoji;
        return res.status(200).json({ box: updateBox(boxId, patch) });
      }

      case 'PUT': {
        if (req.body?.members !== undefined) {
          const members = idList(req.body.members);
          if (!members) return res.status(400).json({ error: 'members must be an array of canonical ids' });
          return res.status(200).json({ box: setBoxMembers(boxId, members) });
        }

        const add = req.body?.add === undefined ? [] : idList(req.body.add);
        const remove = req.body?.remove === undefined ? [] : idList(req.body.remove);
        if (!add || !remove) {
          return res.status(400).json({ error: 'add/remove must be arrays of canonical ids' });
        }
        if (add.length === 0 && remove.length === 0) {
          return res.status(400).json({ error: 'nothing to do: pass members, add or remove' });
        }
        const dropped = new Set(remove);
        const next = [...box.members.filter(m => !dropped.has(m)), ...add];
        return res.status(200).json({ box: setBoxMembers(boxId, next) });
      }

      case 'DELETE':
        deleteBox(boxId);
        return res.status(200).json({ message: 'Box deleted' });

      default:
        res.setHeader('Allow', ['PATCH', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error handling box ${boxId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
