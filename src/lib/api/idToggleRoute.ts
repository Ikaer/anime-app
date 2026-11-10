/**
 * The body every "toggle a per-title annotation" route shared, verbatim:
 * validate the canonical id from `[id]`, `POST` turns the annotation on,
 * `DELETE` turns it off, anything else is a 405, a throw is a 500.
 *
 * Used by `animes/[id]/hide`, `animes/[id]/seed-mute`, `animes/[id]/reco-credit`
 * and `recommendations/ignore/[id]`. Each route still owns what its annotation
 * MEANS (its doc comment, its store) and the response body its client reads —
 * only the plumbing is here. A route needing a request body or a third verb is
 * not a toggle; write it by hand rather than growing this.
 *
 * Server-only: `isCanonicalId` comes through the store barrel.
 */
import type { NextApiHandler } from 'next';
import { isCanonicalId } from '@/lib/store';

export interface IdToggleOptions {
  /** `POST`: turn the annotation on for this canonical id. */
  on: (canonicalId: string) => void;
  /** `DELETE`: turn it off. */
  off: (canonicalId: string) => void;
  /** The 200 body for each direction — kept per route, clients read them. */
  body: (enabled: boolean) => unknown;
  /** Names the annotation in the server log on a failure. */
  label: string;
}

export function idToggleRoute({ on, off, body, label }: IdToggleOptions): NextApiHandler {
  return async (req, res) => {
    const { id } = req.query;
    const animeId = typeof id === 'string' ? id : '';
    if (!isCanonicalId(animeId)) {
      return res.status(400).json({ error: 'Invalid anime ID' });
    }

    try {
      switch (req.method) {
        case 'POST':
          on(animeId);
          return res.status(200).json(body(true));
        case 'DELETE':
          off(animeId);
          return res.status(200).json(body(false));
        default:
          res.setHeader('Allow', ['POST', 'DELETE']);
          return res.status(405).end(`Method ${req.method} Not Allowed`);
      }
    } catch (error) {
      console.error(`Error updating ${label} for anime ${animeId}:`, error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}
