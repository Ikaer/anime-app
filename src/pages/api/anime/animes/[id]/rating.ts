import { NextApiRequest, NextApiResponse } from 'next';
import { getAllMALAnime, saveMALAnime, getAllSimklEntries, upsertSimklEntries } from '@/lib/anime';
import { updateMalListStatus } from '@/lib/malWrite';
import { pushSimklRating } from '@/lib/simklWrite';

/**
 * Set the user's personal score for one anime on BOTH MAL and SIMKL (the user
 * chose to keep the two in sync). The local cache is authority: local MAL +
 * local SIMKL are updated first (so getEffectiveScore reflects the new value
 * immediately — it's SIMKL-first), then the two remote writes fire.
 *
 * Remote writes are non-fatal but NOT silent: their per-source outcome is
 * returned so the client can surface a failed SIMKL write. Without that, a
 * failed SIMKL push would be invisible (local MAL + local SIMKL both already
 * show the new score, so no discrepancy badge appears and no sync corrects it).
 *
 * `score` 0 clears the rating (drag back to the "à noter" tray).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const animeId = parseInt(req.query.id as string, 10);
  if (!Number.isInteger(animeId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  const score = Number((req.body as { score?: unknown })?.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return res.status(400).json({ error: 'Score must be an integer between 0 and 10' });
  }

  try {
    // --- Local writes (authority) ---
    const malData = getAllMALAnime();
    const anime = malData[String(animeId)];
    if (!anime) return res.status(404).json({ error: 'Anime not found' });

    if (!anime.my_list_status) {
      anime.my_list_status = { status: '', score: 0, num_episodes_watched: 0, is_rewatching: false, updated_at: '' };
    }
    anime.my_list_status.score = score;
    anime.my_list_status.updated_at = new Date().toISOString();
    saveMALAnime(malData);

    // Update the local SIMKL entry too, when one exists — getEffectiveScore is
    // SIMKL-first, so without this the drag wouldn't show through for a title
    // that already has a SIMKL entry.
    const simklEntries = getAllSimklEntries();
    const simklEntry = simklEntries[String(animeId)];
    if (simklEntry) {
      simklEntry.score = score > 0 ? score : null;
      upsertSimklEntries([simklEntry]);
    }

    // --- Remote writes (non-fatal, per-source outcome returned) ---
    let mal = { ok: true as boolean, error: undefined as string | undefined };
    try {
      await updateMalListStatus(animeId, { score });
    } catch (e) {
      mal = { ok: false, error: e instanceof Error ? e.message : 'MAL write failed' };
      console.error(`[rating] MAL write failed for ${animeId}:`, e);
    }

    const simkl = await pushSimklRating(animeId, score, {
      simklId: simklEntry?.simkl_id,
      mediaType: anime.media_type,
    });

    return res.status(200).json({ ok: true, score, mal, simkl });
  } catch (error) {
    console.error('Error updating rating:', error);
    return res.status(500).json({ error: 'Failed to update rating' });
  }
}
