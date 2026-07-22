import { NextApiRequest, NextApiResponse } from 'next';
import { getLogEntries } from '@/lib/config/connectionLog';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const afterIdParam = req.query.afterId;
    const afterId =
      typeof afterIdParam === 'string' && afterIdParam !== '' ? parseInt(afterIdParam, 10) : undefined;
    const entries = getLogEntries(afterId);
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Error reading connection log:', error);
    res.status(500).json({ error: 'Failed to read connection log' });
  }
}
