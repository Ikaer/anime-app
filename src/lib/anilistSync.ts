/**
 * AniList catalog-tags sync. Public GraphQL API, no auth. Pulls the tag
 * taxonomy for anime already known locally (via animes_MAL.json) and
 * persists it via anime.ts. Read-only against AniList; no writes.
 */
import { getAllMALAnime, getAllAnilistTags, upsertAnilistTags } from '@/lib/anime';
import { appendLog } from '@/lib/connectionLog';
import { AniListTagEntry, AniListStaffEntry, AniListTagsEntry } from '@/models/anime';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const BATCH_SIZE = 50;
// Top-relevance staff credits to keep per anime — enough for the discriminative
// creative roles (director, character design, music…) without bloating storage.
const STAFF_PER_ANIME = 15;
// Conservative delay between batches (~28 req/min), safely under AniList's
// documented degraded limit of 30 req/min (normally 90/min).
const ANILIST_MIN_DELAY_MS = 2100;

// Tags AND staff in one query per batch (verified live: perPage:50 with a nested
// staff(perPage:15) stays under AniList's query-complexity ceiling). Staff is
// nested inside Page.media — NOT an aliased Media (which null-bombs on any miss).
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
      staff(sort: RELEVANCE, perPage: ${STAFF_PER_ANIME}) {
        edges {
          role
          node {
            id
            name { full }
          }
        }
      }
    }
  }
}`;

interface RawStaffEdge {
  role?: string;
  node?: { id?: number; name?: { full?: string } };
}
interface RawMedia {
  idMal: number;
  id: number;
  tags: AniListTagEntry[];
  staff?: { edges?: RawStaffEdge[] };
}

/** Flatten AniList staff edges to our lean {id,name,role} records. */
function parseStaff(media: RawMedia): AniListStaffEntry[] {
  return (media.staff?.edges ?? [])
    .filter((e): e is RawStaffEdge & { node: { id: number } } => !!e.node?.id)
    .map(e => ({ id: e.node.id, name: e.node?.name?.full ?? '', role: e.role ?? '' }));
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
    const bodyText = await res.text().catch(() => '');
    throw new Error(`AniList request failed: ${res.status} ${res.statusText}${bodyText ? ` — ${bodyText.slice(0, 500)}` : ''}`);
  }

  const json = await res.json();
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    const messages = json.errors.map((e: { message?: string }) => e.message ?? 'unknown error').join('; ');
    throw new Error(`AniList GraphQL error: ${messages}`);
  }
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

/**
 * Force-refresh AniList tags + staff for specific MAL ids, bypassing the
 * "missing only" filter that `performAnilistTagsSync` uses. Powers the per-anime
 * refresh on the detail page. One batch, no throttle loop (caller passes few ids).
 * Returns the number of ids AniList actually had (skips ones it doesn't know).
 */
export async function refreshAnilistTagsForIds(
  malIds: number[]
): Promise<{ ok: boolean; tagged: number; error?: string }> {
  const ids = malIds.filter(id => Number.isInteger(id)).slice(0, BATCH_SIZE);
  if (ids.length === 0) return { ok: true, tagged: 0 };
  try {
    const media = await fetchTagsBatch(ids);
    const now = new Date().toISOString();
    const entries: AniListTagsEntry[] = media
      .filter(m => m.idMal)
      .map(m => ({
        mal_id: m.idMal,
        anilist_id: m.id,
        tags: m.tags ?? [],
        staff: parseStaff(m),
        fetched_at: now,
      }));
    if (entries.length > 0) upsertAnilistTags(entries);
    return { ok: true, tagged: entries.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    appendLog('anilist-tags-sync', 'error', `AniList refresh failed for ids ${ids.join(',')}: ${message}`);
    return { ok: false, tagged: 0, error: message };
  }
}

export async function performAnilistTagsSync(): Promise<AnilistTagsSyncResult> {
  if (isAnilistTagsSyncRunning) {
    appendLog('anilist-tags-sync', 'info', 'AniList tags sync skipped: already running');
    return { ok: false, alreadyRunning: true, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
  }

  isAnilistTagsSyncRunning = true;
  try {
    const malAnime = getAllMALAnime();
    const existingTags = getAllAnilistTags();
    // Fetch anime with no AniList entry yet, OR an entry predating staff support
    // (staff === undefined) so staff backfills onto already-tagged titles.
    const missingIds = Object.values(malAnime)
      .map(a => a.id)
      .filter(id => {
        const e = existingTags[id.toString()];
        return !e || e.staff === undefined;
      });

    if (missingIds.length === 0) {
      appendLog('anilist-tags-sync', 'success', 'AniList sync: nothing to do, all anime already have tags + staff');
      return { ok: true, alreadyRunning: false, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
    }

    appendLog('anilist-tags-sync', 'info', `AniList tags sync started: ${missingIds.length} anime to fetch`);

    const batches = chunk(missingIds, BATCH_SIZE);
    let processed = 0;
    let tagged = 0;
    let failed = 0;

    for (const [batchIndex, batch] of batches.entries()) {
      try {
        const media = await fetchTagsBatch(batch);
        const now = new Date().toISOString();
        const entries: AniListTagsEntry[] = media
          .filter(m => m.idMal)
          .map(m => ({
            mal_id: m.idMal,
            anilist_id: m.id,
            tags: m.tags ?? [],
            staff: parseStaff(m),
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`AniList tags batch ${batchIndex + 1}/${batches.length} error (mal ids ${batch[0]}-${batch[batch.length - 1]}):`, error);
        appendLog(
          'anilist-tags-sync',
          'error',
          `AniList tags batch ${batchIndex + 1}/${batches.length} failed, continuing: ${errorMessage}`,
          {
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            batchSize: batch.length,
            malIds: batch,
            error: errorMessage,
          }
        );
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
