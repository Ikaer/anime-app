import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeExtension, saveAnimeExtension, deleteAnimeExtension } from '@/lib/anime';
import { AnimeExtension } from '@/models/anime';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Anime ID is required' });
    }

    switch (req.method) {
      case 'GET':
        return handleGet(req, res, id);
      case 'POST':
        return handlePost(req, res, id);
      case 'DELETE':
        return handleDelete(req, res, id);
      default:
        res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error('Extensions API error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

function handleGet(req: NextApiRequest, res: NextApiResponse, malId: string) {
  const extensions = getAnimeExtension(malId);
  
  res.json({
    extensions: extensions || {
      providers: [],
      notes: ''
    }
  });
}

function handlePost(req: NextApiRequest, res: NextApiResponse, malId: string) {
  const { providers, notes } = req.body;

  // Validate input
  if (!Array.isArray(providers)) {
    return res.status(400).json({ error: 'Providers must be an array' });
  }

  // Validate provider objects
  for (const provider of providers) {
    if (typeof provider.name !== 'string' || typeof provider.url !== 'string') {
      return res.status(400).json({ 
        error: 'Each provider must have name and url strings' 
      });
    }
  }

  if (typeof notes !== 'string') {
    return res.status(400).json({ error: 'Notes must be a string' });
  }

  const extension: AnimeExtension = {
    providers,
    notes: notes.trim()
  };

  saveAnimeExtension(malId, extension);

  res.json({
    success: true,
    extensions: extension
  });
}

function handleDelete(req: NextApiRequest, res: NextApiResponse, malId: string) {
  deleteAnimeExtension(malId);
  
  res.json({
    success: true
  });
}
