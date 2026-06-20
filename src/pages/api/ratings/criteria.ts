import type { NextApiRequest, NextApiResponse } from 'next';
import { getRatingCriteria, seedCriteriaIfAbsent } from '@/lib/ratings';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end();
  }

  seedCriteriaIfAbsent();
  res.status(200).json(getRatingCriteria());
}
