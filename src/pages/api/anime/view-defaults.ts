import { NextApiRequest, NextApiResponse } from 'next';
import { readSettings, saveSettings, getViewDefaults } from '@/lib/config/settings';
import { resolveViewDefaults, sparseViewDefaults } from '@/lib/url/viewDefaults';

/**
 * View defaults — the landing preset, the sparse filter overrides, and the
 * display preferences that replaced the `cpr`/`sb` URL keys.
 *
 * **Its own endpoint rather than a slice of `/api/anime/settings`**, because
 * every card grid reads it on mount: the settings route returns provider
 * credentials (redacted, but still) and derives three OAuth redirect URIs from
 * the request host, none of which the main list has any business fetching. This
 * one reads a single small JSON and carries no secret.
 *
 * The settings page writes the same field through its own POST, so both land in
 * `saveSettings` and there is one sanitizer. Last write wins between the two —
 * which is fine for one user with one browser, and the alternative (a field-level
 * merge protocol) would be machinery for a conflict that cannot happen.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return res.json({ viewDefaults: getViewDefaults() });

      case 'POST': {
        // The body is the FULL defaults object (the client patches its own
        // snapshot before sending), resolved here so a partial or hand-rolled
        // payload still lands as a complete, valid value.
        const next = resolveViewDefaults(req.body ?? {});
        saveSettings({ ...readSettings(), viewDefaults: sparseViewDefaults(next) ?? undefined });
        return res.json({ viewDefaults: getViewDefaults() });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error('View defaults API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
