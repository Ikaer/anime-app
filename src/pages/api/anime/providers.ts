import { NextApiRequest, NextApiResponse } from 'next';
import { getProviderStatuses } from '@/lib/providers/status';

/**
 * **The** provider status read: one row per
 * provider — what it is, what it can do, whether it is connected, and how many
 * entries it holds.
 *
 * It does NOT replace the per-provider `auth` endpoints: those own the OAuth
 * flows (login redirect, callback, logout) and stay where they are, one per
 * service, because the flows genuinely differ. This is the uniform *read* the
 * connections page and the header badges render from, so neither has to know
 * that MAL answers `user.name` while SIMKL answers `user.user.name`.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
  try {
    return res.json(getProviderStatuses());
  } catch (error) {
    console.error('Provider status error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
