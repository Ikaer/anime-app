import type { NextApiRequest, NextApiResponse } from 'next';
import { getBox, updateBox, deleteBox, setBoxMembers, editBoxMembers, editBoxExcluded, editBoxGroups, setBoxProfile } from '@/lib/reco/boxes';
import { getProfile } from '@/lib/reco/profiles';
import { isCanonicalId } from '@/lib/store';

/**
 * One box.
 *   PATCH  { name?, emoji?, description? }    — rename / re-emoji / re-describe (the id never moves)
 *   PUT    { members } | { add?, remove?, exclude?, unexclude?, declare?, undeclare?, profileId? }
 *          — membership, the « écartés » set, which groups collapse here, and
 *            the reco profile its recos rank with (`profileId: null` detaches)
 *   DELETE                                    — drop the box
 *
 * `profileId` rides on PUT rather than PATCH because PATCH is the box's
 * DESCRIPTION (what `updateBox` and the MCP's `edit_box` write), while a profile
 * changes how the box ranks — the same side of the line as its groups.
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
        const patch: { name?: string; emoji?: string | null; description?: string | null } = {};
        if (typeof req.body?.name === 'string') patch.name = req.body.name;
        // `null` clears the emoji; `undefined` leaves it alone.
        if (req.body?.emoji === null || typeof req.body?.emoji === 'string') patch.emoji = req.body.emoji;
        // Same convention, plus: an empty string clears too, because the editor
        // is a textarea the owner empties rather than a control that sends null.
        if (req.body?.description === null || typeof req.body?.description === 'string') {
          patch.description = req.body.description;
        }
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
        const exclude = req.body?.exclude === undefined ? [] : idList(req.body.exclude);
        const unexclude = req.body?.unexclude === undefined ? [] : idList(req.body.unexclude);
        if (!add || !remove || !exclude || !unexclude) {
          return res.status(400).json({ error: 'add/remove/exclude/unexclude must be arrays of canonical ids' });
        }
        // Group ids are slugs, not canonical ids, so they get their own check.
        const slugList = (v: unknown): string[] | null =>
          v === undefined ? [] : (Array.isArray(v) && v.every(x => typeof x === 'string' && x.length > 0) ? v as string[] : null);
        const declare = slugList(req.body?.declare);
        const undeclare = slugList(req.body?.undeclare);
        if (!declare || !undeclare) {
          return res.status(400).json({ error: 'declare/undeclare must be arrays of group ids' });
        }

        // `undefined` leaves the attachment alone, `null` detaches, a string attaches.
        const profileId: string | null | undefined = req.body?.profileId;
        if (profileId !== undefined && profileId !== null && typeof profileId !== 'string') {
          return res.status(400).json({ error: 'profileId must be a profile id or null' });
        }
        // Checked here, not in `setBoxProfile`: `boxes.ts` cannot import
        // `profiles.ts`, which imports it. Attaching an id that resolves to
        // nothing would be a silent no-op on every ranking — refuse it instead.
        if (typeof profileId === 'string' && !getProfile(profileId)) {
          return res.status(404).json({ error: 'Profile not found' });
        }

        const nothing = [add, remove, exclude, unexclude, declare, undeclare].every(a => a.length === 0)
          && profileId === undefined;
        if (nothing) {
          return res.status(400).json({ error: 'nothing to do: pass members, add, remove, exclude, unexclude, declare, undeclare or profileId' });
        }

        // Order matters in exactly one place: `editBoxExcluded` drops whatever it
        // excludes from `members`, so it must run AFTER the membership edit or a
        // combined { add, exclude } would re-file the title it just excluded.
        // The other two are independent — `declare` never touches membership.
        let updated = box;
        if (add.length > 0 || remove.length > 0) updated = editBoxMembers(boxId, add, remove) ?? updated;
        if (exclude.length > 0 || unexclude.length > 0) updated = editBoxExcluded(boxId, exclude, unexclude) ?? updated;
        if (declare.length > 0 || undeclare.length > 0) updated = editBoxGroups(boxId, declare, undeclare) ?? updated;
        if (profileId !== undefined) updated = setBoxProfile(boxId, profileId) ?? updated;
        return res.status(200).json({ box: updated });
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
