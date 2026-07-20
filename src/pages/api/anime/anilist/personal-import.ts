import { NextApiRequest, NextApiResponse } from 'next';
import { importAnilistPersonalList, getAnilistPersonalConfig } from '@/lib/anilistPersonalSync';
import { getAnilistPersonalCount } from '@/lib/store';
import { getAnilistAccessToken } from '@/lib/anilistAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Mirror meta-sync's GET: surface the stored count so the connections UI can
    // show current state on mount. `authenticated` gates the button — the import
    // reads the viewer's own list and has no anonymous fallback.
    const cfg = getAnilistPersonalConfig();
    return res.status(200).json({
      lastImportedCount: cfg.lastImportedCount,
      lastImportedAt: cfg.lastImportedAt,
      storedCount: getAnilistPersonalCount(),
      authenticated: getAnilistAccessToken() != null,
    });
  }

  if (req.method === 'POST') {
    // SYNCHRONOUS (unlike the fire-and-forget batch syncs): the import is a
    // single GraphQL call and the contract returns real counts.
    const result = await importAnilistPersonalList();
    // 401 when not connected, 404 when the viewer can't be identified, 502 for
    // an upstream/network failure, 200 on success.
    const status = result.ok
      ? 200
      : result.errorKind === 'no_auth'
        ? 401
        : result.errorKind === 'not_found'
          ? 404
          : 502;
    return res.status(status).json(result);
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
