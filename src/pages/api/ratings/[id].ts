import type { NextApiRequest, NextApiResponse } from 'next';
import { deleteRating } from '@/lib/ratings';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).end();
  }

  const { id } = req.query;
  if (typeof id !== 'string') return res.status(400).json({ error: 'Invalid id' });

  const deleted = deleteRating(id);
  if (!deleted) return res.status(404).json({ error: 'Rating not found' });

  res.status(200).json({ success: true });
}
