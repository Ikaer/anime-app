/**
 * AniList catalog-tags sync. Public GraphQL API, no auth. Pulls the tag
 * taxonomy for anime already known locally (via animes_MAL.json) and
 * persists it via anime.ts. Read-only against AniList; no writes.
 */
import { getAllMALAnime, getAllAnilistTags, upsertAnilistTags } from '@/lib/anime';
import { appendLog } from '@/lib/connectionLog';
import { AniListTagEntry, AniListTagsEntry } from '@/models/anime';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const BATCH_SIZE = 50;
// Conservative delay between batches (~28 req/min), safely under AniList's
// documented degraded limit of 30 req/min (normally 90/min).
const ANILIST_MIN_DELAY_MS = 2100;

const TAGS_QUERY = `
query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    media(idMal_in: $ids, type: ANIME) {
      idMal
      id
      tags {
        name
        rank
        category
      }
    }
  }
}`;

interface RawMedia {
  idMal: number;
  id: number;
  tags: AniListTagEntry[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function fetchTagsBatch(malIds: number[], retryOn429 = true): Promise<RawMedia[]> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: TAGS_QUERY, variables: { ids: malIds } }),
  });

  if (res.status === 429) {
    if (!retryOn429) {
      throw new Error('AniList rate limit exceeded (retry already attempted)');
    }
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 60_000;
    await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfterMs) ? retryAfterMs : 60_000));
    return fetchTagsBatch(malIds, false);
  }

  if (!res.ok) {
    throw new Error(`AniList request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return (json?.data?.Page?.media ?? []) as RawMedia[];
}

export interface AnilistTagsSyncResult {
  ok: boolean;
  alreadyRunning: boolean;
  totalMissing: number;
  processed: number;
  tagged: number;
  failed: number;
  error?: string;
}

let isAnilistTagsSyncRunning = false;

export async function performAnilistTagsSync(): Promise<AnilistTagsSyncResult> {
  if (isAnilistTagsSyncRunning) {
    appendLog('anilist-tags-sync', 'info', 'AniList tags sync skipped: already running');
    return { ok: false, alreadyRunning: true, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
  }

  isAnilistTagsSyncRunning = true;
  try {
    const malAnime = getAllMALAnime();
    const existingTags = getAllAnilistTags();
    const missingIds = Object.values(malAnime)
      .map(a => a.id)
      .filter(id => !existingTags[id.toString()]);

    if (missingIds.length === 0) {
      appendLog('anilist-tags-sync', 'success', 'AniList tags sync: nothing to do, all anime already tagged');
      return { ok: true, alreadyRunning: false, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
    }

    appendLog('anilist-tags-sync', 'info', `AniList tags sync started: ${missingIds.length} anime to fetch`);

    const batches = chunk(missingIds, BATCH_SIZE);
    let processed = 0;
    let tagged = 0;
    let failed = 0;

    for (const batch of batches) {
      try {
        const media = await fetchTagsBatch(batch);
        const now = new Date().toISOString();
        const entries: AniListTagsEntry[] = media
          .filter(m => m.idMal)
          .map(m => ({
            mal_id: m.idMal,
            anilist_id: m.id,
            tags: m.tags ?? [],
            fetched_at: now,
          }));
        if (entries.length > 0) {
          upsertAnilistTags(entries);
          tagged += entries.length;
        }
        processed += batch.length;
        appendLog('anilist-tags-sync', 'info', `AniList tags: ${processed}/${missingIds.length} processed`, {
          processed,
          totalMissing: missingIds.length,
          tagged,
        });
      } catch (error) {
        failed += batch.length;
        processed += batch.length;
        console.error('AniList tags batch error:', error);
        appendLog('anilist-tags-sync', 'error', 'AniList tags batch failed, continuing', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      if (processed < missingIds.length) {
        await new Promise(resolve => setTimeout(resolve, ANILIST_MIN_DELAY_MS));
      }
    }

    appendLog('anilist-tags-sync', 'success', `AniList tags sync complete: ${tagged} tagged, ${failed} failed`, {
      processed,
      tagged,
      failed,
    });

    return { ok: true, alreadyRunning: false, totalMissing: missingIds.length, processed, tagged, failed };
  } catch (error) {
    console.error('AniList tags sync error:', error);
    appendLog('anilist-tags-sync', 'error', 'AniList tags sync failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      ok: false,
      alreadyRunning: false,
      totalMissing: 0,
      processed: 0,
      tagged: 0,
      failed: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    isAnilistTagsSyncRunning = false;
  }
}
