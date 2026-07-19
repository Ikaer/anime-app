import { NextApiRequest, NextApiResponse } from 'next';
import { importAnilistPersonalList, getAnilistPersonalConfig } from '@/lib/anilistPersonalSync';
import { getAnilistPersonalCount } from '@/lib/store';
import { getAnilistAccessToken } from '@/lib/anilistAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Mirror meta-sync's GET: surface the saved username + stored count so the
    // connections UI can show current state on mount.
    const cfg = getAnilistPersonalConfig();
    return res.status(200).json({
      username: cfg.username,
      lastImportedCount: cfg.lastImportedCount,
      lastImportedAt: cfg.lastImportedAt,
      storedCount: getAnilistPersonalCount(),
      // With a live token the client may POST with no username at all — the
      // import then reads the viewer's own (possibly private) list.
      authenticated: getAnilistAccessToken() != null,
    });
  }

  if (req.method === 'POST') {
    // SYNCHRONOUS (unlike the fire-and-forget batch syncs): the import is a
    // single GraphQL call and the contract returns real counts.
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
    const username = typeof body?.username === 'string' ? body.username : '';

    const result = await importAnilistPersonalList(username);
    // 404 for the two "your fault" username cases so the client can branch on
    // status too; 502 for an upstream/network failure; 200 on success.
    const status = result.ok
      ? 200
      : result.errorKind === 'private' || result.errorKind === 'not_found'
        ? 404
        : result.errorKind === 'empty'
          ? 400
          : 502;
    return res.status(status).json(result);
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}

function safeParse(raw: string): { username?: string } {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}
