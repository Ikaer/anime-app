import { NextApiRequest, NextApiResponse } from 'next';
import { performSimklSync } from '@/lib/simklSync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    return;
  }
  const result = await performSimklSync();
  res.status(result.ok ? 200 : 500).json(result);
}
