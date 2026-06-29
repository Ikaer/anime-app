import { NextApiRequest, NextApiResponse } from 'next';
import { getMALAuthData, isMALTokenValid, getHistoricalCrawlStats, performHistoricalCrawl } from '@/lib/anime';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(getHistoricalCrawlStats());
  }

  if (req.method === 'POST') {
    const { token } = getMALAuthData();
    if (!token || !isMALTokenValid(token)) {
      return res.status(401).json({ error: 'Not authenticated with MAL' });
    }

    const result = await performHistoricalCrawl(token.access_token);

    if (result.alreadyRunning) {
      return res.status(409).json({ error: 'Historical crawl already in progress' });
    }

    return res.status(result.success ? 200 : 500).json(result);
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
