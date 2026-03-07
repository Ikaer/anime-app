import { NextApiRequest, NextApiResponse } from 'next';
import { getMALAuthData, isMALTokenValid } from '@/lib/anime';

// This is a simplified version of the big-sync trigger
// It doesn't handle the SSE part, as it's meant for an automated cron job

async function startBigSync() {
  try {
    const response = await fetch('http://localhost:3000/api/anime/big-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to start big sync');
    }

    const data = await response.json();
    console.log('Cron sync started:', data.syncId);
    return data;
  } catch (error) {
    console.error('Error in cron-sync when starting big sync:', error);
    throw error;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Basic security check: can be improved with a secret key
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Check MAL authentication status before starting
    const { token } = getMALAuthData();
    if (!token || !isMALTokenValid(token)) {
      // Here you might want to implement logic to refresh the token automatically
      // For now, we just log and fail if not valid
      console.error('Cron sync cannot run: MAL token is invalid or missing.');
      return res.status(400).json({ error: 'MAL token is invalid or missing. Cannot start sync.' });
    }

    await startBigSync();
    res.status(200).json({ message: 'Cron sync process initiated successfully.' });
  } catch (error) {
    console.error('Cron sync handler failed:', error);
    res.status(500).json({ 
      error: 'Failed to initiate cron sync',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
