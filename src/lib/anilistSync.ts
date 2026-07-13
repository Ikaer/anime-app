/**
 * AniList catalog-metadata sync. Public GraphQL API, no auth. Pulls the tag
 * taxonomy, the top staff credits and the banner art for anime already known
 * locally (via animes_mal.json) and persists them via store.ts. Read-only
 * against AniList; no writes.
 */
import { getAllAnime, getAllAnilistMeta, upsertAnilistMeta, upsertAnilistCatalogFields, resolveCanonicalIds, getRegistry } from '@/lib/store';
import { appendLog } from '@/lib/connectionLog';
import { getSeasonInfos } from '@/lib/animeUtils';
import { AniListTagEntry, AniListStaffEntry, AniListMetaEntry } from '@/models/anime';

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
      bannerImage
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
  bannerImage?: string | null;
  tags: AniListTagEntry[];
  staff?: { edges?: RawStaffEdge[] };
}

/**
 * One AniList media node -> our stored entry. `banner_image` is coerced to an
 * explicit `null` when AniList has none, so `undefined` keeps meaning "never
 * fetched" and stays usable as the backfill signal.
 */
function toEntry(m: RawMedia, fetchedAt: string): AniListMetaEntry {
  return {
    mal_id: m.idMal,
    anilist_id: m.id,
    tags: m.tags ?? [],
    staff: parseStaff(m),
    banner_image: m.bannerImage ?? null,
    fetched_at: fetchedAt,
  };
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

// Crowd recommendations query — kept SEPARATE from TAGS_QUERY (tags + staff
// already sit near AniList's query-complexity ceiling; stacking a
// recommendations connection on top risks blowing it). Lightweight: only idMal
// + the recommendations edge. `mediaRecommendation.idMal` resolves the rec
// straight back onto our MAL join key, so no crosswalk is needed.
const RECS_PER_ANIME = 15;
const RECS_QUERY = `
query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    media(idMal_in: $ids, type: ANIME) {
      idMal
      recommendations(sort: RATING_DESC, perPage: ${RECS_PER_ANIME}) {
        edges {
          node {
            rating
            mediaRecommendation { idMal }
          }
        }
      }
    }
  }
}`;

interface RawRecEdge {
  node?: { rating?: number; mediaRecommendation?: { idMal?: number | null } };
}
interface RawRecMedia {
  idMal: number;
  recommendations?: { edges?: RawRecEdge[] };
}

/** One AniList crowd recommendation resolved onto a MAL id, with its net rating. */
export interface AniListRecEdge {
  /** Recommended anime's MAL id. */
  id: number;
  /** AniList net recommendation rating (crowd backers) — always > 0 here. */
  rating: number;
}

async function fetchRecsBatch(malIds: number[], retryOn429 = true): Promise<RawRecMedia[]> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: RECS_QUERY, variables: { ids: malIds } }),
  });

  if (res.status === 429) {
    if (!retryOn429) throw new Error('AniList rate limit exceeded (retry already attempted)');
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 60_000;
    await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfterMs) ? retryAfterMs : 60_000));
    return fetchRecsBatch(malIds, false);
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
  return (json?.data?.Page?.media ?? []) as RawRecMedia[];
}

/**
 * Fetch AniList crowd recommendations for the given seed MAL ids, batched by 50
 * and throttled like the tags sync. Returns a map of seed MAL id -> recommended
 * MAL edges (recs AniList couldn't map to a MAL id, or with a non-positive net
 * rating, are dropped). AniList silently skips ids it doesn't know, so the map
 * only contains seeds it recognized.
 */
export async function fetchAnilistRecommendations(
  seedMalIds: number[],
  onBatch?: (done: number, total: number) => void
): Promise<Map<number, AniListRecEdge[]>> {
  const ids = seedMalIds.filter(id => Number.isInteger(id));
  const batches = chunk(ids, BATCH_SIZE);
  const out = new Map<number, AniListRecEdge[]>();
  let processed = 0;

  for (const batch of batches) {
    try {
      const media = await fetchRecsBatch(batch);
      for (const m of media) {
        if (!m.idMal) continue;
        const edges: AniListRecEdge[] = (m.recommendations?.edges ?? [])
          .map(e => ({ id: e.node?.mediaRecommendation?.idMal ?? 0, rating: e.node?.rating ?? 0 }))
          .filter(e => e.id > 0 && e.rating > 0);
        if (edges.length > 0) out.set(m.idMal, edges);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      appendLog('anilist-meta-sync', 'error', `AniList recos batch failed (mal ids ${batch[0]}-${batch[batch.length - 1]}), continuing: ${message}`);
    }
    processed += batch.length;
    if (onBatch) onBatch(processed, ids.length);
    if (processed < ids.length) {
      await new Promise(resolve => setTimeout(resolve, ANILIST_MIN_DELAY_MS));
    }
  }
  return out;
}

export interface AniListMetaSyncResult {
  ok: boolean;
  alreadyRunning: boolean;
  totalMissing: number;
  processed: number;
  tagged: number;
  failed: number;
  error?: string;
}

let isAnilistMetaSyncRunning = false;

/**
 * Force-refresh AniList tags + staff for specific MAL ids, bypassing the
 * "missing only" filter that `performAnilistMetaSync` uses. Powers the per-anime
 * refresh on the detail page. One batch, no throttle loop (caller passes few ids).
 * Returns the number of ids AniList actually had (skips ones it doesn't know).
 */
export async function refreshAnilistMetaForIds(
  malIds: number[]
): Promise<{ ok: boolean; tagged: number; error?: string }> {
  const ids = malIds.filter(id => Number.isInteger(id)).slice(0, BATCH_SIZE);
  if (ids.length === 0) return { ok: true, tagged: 0 };
  try {
    const media = await fetchTagsBatch(ids);
    const now = new Date().toISOString();
    const entries: AniListMetaEntry[] = media.filter(m => m.idMal).map(m => toEntry(m, now));
    if (entries.length > 0) upsertAnilistMeta(entries);
    return { ok: true, tagged: entries.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    appendLog('anilist-meta-sync', 'error', `AniList refresh failed for ids ${ids.join(',')}: ${message}`);
    return { ok: false, tagged: 0, error: message };
  }
}

export async function performAnilistMetaSync(): Promise<AniListMetaSyncResult> {
  if (isAnilistMetaSyncRunning) {
    appendLog('anilist-meta-sync', 'info', 'AniList metadata sync skipped: already running');
    return { ok: false, alreadyRunning: true, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
  }

  isAnilistMetaSyncRunning = true;
  try {
    const malAnime = getAllAnime();
    // Both slices are canonical-keyed now, so index the meta by its own `mal_id`
    // to test coverage against the MAL slice's `a.id` (still the MAL id).
    const metaByMal = new Map(Object.values(getAllAnilistMeta()).map(e => [e.mal_id, e]));
    // Fetch anime with no AniList entry yet, OR an entry predating staff / banner
    // support (field === undefined) so those backfill onto already-tagged titles.
    // A banner AniList doesn't have is stored as null, so it never re-queues.
    const missingIds = Object.values(malAnime)
      .map(a => a.id)
      .filter(id => {
        const e = metaByMal.get(id);
        return !e || e.staff === undefined || e.banner_image === undefined;
      });

    if (missingIds.length === 0) {
      appendLog('anilist-meta-sync', 'success', 'AniList sync: nothing to do, all anime already have tags + staff');
      return { ok: true, alreadyRunning: false, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
    }

    appendLog('anilist-meta-sync', 'info', `AniList metadata sync started: ${missingIds.length} anime to fetch`);

    const batches = chunk(missingIds, BATCH_SIZE);
    let processed = 0;
    let tagged = 0;
    let failed = 0;

    for (const [batchIndex, batch] of batches.entries()) {
      try {
        const media = await fetchTagsBatch(batch);
        const now = new Date().toISOString();
        const entries: AniListMetaEntry[] = media.filter(m => m.idMal).map(m => toEntry(m, now));
        if (entries.length > 0) {
          upsertAnilistMeta(entries);
          tagged += entries.length;
        }
        processed += batch.length;
        appendLog('anilist-meta-sync', 'info', `AniList tags: ${processed}/${missingIds.length} processed`, {
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
          'anilist-meta-sync',
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

    appendLog('anilist-meta-sync', 'success', `AniList metadata sync complete: ${tagged} tagged, ${failed} failed`, {
      processed,
      tagged,
      failed,
    });

    return { ok: true, alreadyRunning: false, totalMissing: missingIds.length, processed, tagged, failed };
  } catch (error) {
    console.error('AniList metadata sync error:', error);
    appendLog('anilist-meta-sync', 'error', 'AniList metadata sync failed', {
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
    isAnilistMetaSyncRunning = false;
  }
}

// ============================================================================
// AniList catalog crawler (docs/PROVIDER-FREE.md Phase 3)
// ============================================================================
//
// Unlike the tags/staff sync above (which enriches titles ALREADY known via
// `animes_mal.json`, one MAL id at a time), this browses AniList's OWN catalog
// by season — the capability that lets AniList seed the registry
// INDEPENDENTLY of MAL, verified unauthenticated in Phase 0 (see
// docs/PROVIDER-FREE.md). Titles it finds WITH a MAL id enrich the existing
// per-MAL-id AniList meta entry (`catalog` block, merged not overwritten —
// see `upsertAnilistCatalogFields`); titles it finds WITHOUT one (AniList-only)
// only get a bare canonical id minted in the registry — there is nowhere yet
// to put their catalog data, since `AnimeForDisplay`/`getAnimeForDisplay()`
// are still exclusively keyed by MAL id. Surfacing AniList-only titles is the
// outward-id join switch (Phase 3's own later sub-project), not this crawler's
// job — see docs/PROVIDER-FREE.md's "Standalone worth" note on the join switch.

const CATALOG_QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: ${BATCH_SIZE}) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, type: ANIME) {
      id
      idMal
      title { romaji english }
      coverImage { medium large }
      description
      format
      episodes
      status
      season
      seasonYear
      startDate { year month day }
      popularity
      averageScore
      genres
      studios { nodes { id name } }
    }
  }
}`;

interface RawCatalogMedia {
  id: number;
  idMal?: number | null;
  title?: { romaji?: string | null; english?: string | null };
  coverImage?: { medium?: string | null; large?: string | null } | null;
  description?: string | null;
  format?: string | null;
  episodes?: number | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  popularity?: number | null;
  averageScore?: number | null;
  genres?: (string | null)[] | null;
  studios?: { nodes?: ({ id?: number | null; name?: string | null } | null)[] | null } | null;
}

// ── AniList → MAL vocabulary maps (the widened catalog fields normalize to MAL's
// shape at crawl time, so a hydrated AniList-only row reads identically to a MAL
// one downstream). ──

/** AniList `format` → MAL `media_type` (lowercase). */
function mapFormat(format?: string | null): string | undefined {
  switch (format) {
    case 'TV': return 'tv';
    case 'TV_SHORT': return 'tv';
    case 'MOVIE': return 'movie';
    case 'SPECIAL': return 'special';
    case 'OVA': return 'ova';
    case 'ONA': return 'ona';
    case 'MUSIC': return 'music';
    default: return format ? format.toLowerCase() : undefined;
  }
}

/** AniList `status` → MAL airing status (`finished_airing`|`currently_airing`|`not_yet_aired`). */
function mapAiringStatus(status?: string | null): string | undefined {
  switch (status) {
    case 'FINISHED':
    case 'CANCELLED': return 'finished_airing';
    case 'RELEASING':
    case 'HIATUS': return 'currently_airing';
    case 'NOT_YET_RELEASED': return 'not_yet_aired';
    default: return undefined;
  }
}

/** AniList `startDate` fuzzy-date → MAL `start_date` string ("YYYY" / "YYYY-MM" / "YYYY-MM-DD"). */
function mapStartDate(d?: { year?: number | null; month?: number | null; day?: number | null } | null): string | undefined {
  if (!d?.year) return undefined;
  const pad = (n: number) => n.toString().padStart(2, '0');
  let s = `${d.year}`;
  if (d.month) {
    s += `-${pad(d.month)}`;
    if (d.day) s += `-${pad(d.day)}`;
  }
  return s;
}

/** AniList HTML description → plain text (MAL synopsis is plain). Strips tags + decodes the few entities AniList emits. */
function stripHtml(html?: string | null): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}
interface RawCatalogPage {
  pageInfo?: { hasNextPage?: boolean };
  media: RawCatalogMedia[];
}

async function fetchCatalogPage(season: string, seasonYear: number, page: number, retryOn429 = true): Promise<RawCatalogPage> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: CATALOG_QUERY, variables: { season, seasonYear, page } }),
  });

  if (res.status === 429) {
    if (!retryOn429) throw new Error('AniList rate limit exceeded (retry already attempted)');
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 60_000;
    await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfterMs) ? retryAfterMs : 60_000));
    return fetchCatalogPage(season, seasonYear, page, false);
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
  return (json?.data?.Page ?? { media: [] }) as RawCatalogPage;
}

export interface AniListCatalogCrawlResult {
  ok: boolean;
  alreadyRunning: boolean;
  season: string;
  seasonYear: number;
  pagesFetched: number;
  withMal: number;
  anilistOnlyMinted: number;
  anilistOnlyAlreadyAnchored: number;
  error?: string;
}

let isAnilistCatalogCrawlRunning = false;

/**
 * Crawl one AniList season (default: the current season, from `getSeasonInfos`)
 * by popularity, capped at `maxPages` pages (default 3, i.e. ≤150 titles) — a
 * bounded first slice proving the capability end-to-end, not an attempt at
 * AniList's full historical catalog (that scale-up mirrors how MAL's own
 * `historical-crawl` came AFTER its lightweight sync, not before).
 */
export async function performAnilistCatalogCrawl(
  season?: string,
  seasonYear?: number,
  maxPages = 3
): Promise<AniListCatalogCrawlResult> {
  const resolvedSeason = season?.toUpperCase() ?? getSeasonInfos().current.season.toUpperCase();
  const resolvedYear = seasonYear ?? getSeasonInfos().current.year;

  if (isAnilistCatalogCrawlRunning) {
    appendLog('anilist-catalog-crawl', 'info', 'AniList catalog crawl skipped: already running');
    return { ok: false, alreadyRunning: true, season: resolvedSeason, seasonYear: resolvedYear, pagesFetched: 0, withMal: 0, anilistOnlyMinted: 0, anilistOnlyAlreadyAnchored: 0 };
  }

  isAnilistCatalogCrawlRunning = true;
  try {
    appendLog('anilist-catalog-crawl', 'info', `AniList catalog crawl started: ${resolvedSeason} ${resolvedYear}, up to ${maxPages} pages`);

    const withMalEntries: Array<{ mal_id: number; anilist_id: number; catalog: NonNullable<AniListMetaEntry['catalog']> }> = [];
    const anilistOnlyIds: number[] = [];
    let pagesFetched = 0;

    for (let page = 1; page <= maxPages; page++) {
      const result = await fetchCatalogPage(resolvedSeason, resolvedYear, page);
      pagesFetched++;

      for (const m of result.media ?? []) {
        const title = m.title?.english || m.title?.romaji;
        if (!title) continue;
        const mean = typeof m.averageScore === 'number' ? m.averageScore / 10 : undefined;
        // AniList genres are names only → synthetic id 0 (consumers key on name).
        const genres = (m.genres ?? [])
          .filter((g): g is string => !!g)
          .map(name => ({ id: 0, name }));
        // AniList studios carry AniList-namespace ids (see AniListMetaEntry.catalog caveat).
        const studios = (m.studios?.nodes ?? [])
          .filter((s): s is { id?: number | null; name?: string | null } => !!s && !!s.name)
          .map(s => ({ id: s.id ?? 0, name: s.name as string }));
        const cover = m.coverImage?.medium || m.coverImage?.large
          ? { medium: m.coverImage?.medium ?? m.coverImage?.large ?? '', large: m.coverImage?.large ?? m.coverImage?.medium ?? '' }
          : undefined;
        const catalog: NonNullable<AniListMetaEntry['catalog']> = {
          title,
          titleRomaji: m.title?.romaji ?? undefined,
          titleEnglish: m.title?.english ?? undefined,
          mean,
          genres,
          studios,
          coverImage: cover,
          synopsis: stripHtml(m.description),
          mediaType: mapFormat(m.format),
          airingStatus: mapAiringStatus(m.status),
          numEpisodes: typeof m.episodes === 'number' ? m.episodes : undefined,
          startDate: mapStartDate(m.startDate),
          startSeason: m.season && typeof m.seasonYear === 'number'
            ? { year: m.seasonYear, season: m.season.toLowerCase() }
            : undefined,
          numListUsers: typeof m.popularity === 'number' ? m.popularity : undefined,
        };
        if (m.idMal) {
          withMalEntries.push({ mal_id: m.idMal, anilist_id: m.id, catalog });
        } else {
          anilistOnlyIds.push(m.id);
        }
      }

      appendLog('anilist-catalog-crawl', 'info', `AniList catalog: page ${page}/${maxPages} fetched`, { page, maxPages });

      if (!result.pageInfo?.hasNextPage) break;
      if (page < maxPages) await new Promise(resolve => setTimeout(resolve, ANILIST_MIN_DELAY_MS));
    }

    // with-MAL titles: upsertAnilistCatalogFields resolves-before-mint internally
    // and writes the catalog block under the canonical key (registering the
    // {mal, anilist} crosswalk). AniList-only titles have no slice to write, so
    // they mint a bare {anilist} canonical id straight through the resolver. The
    // registry is the identity spine — the crawl is a first-class writer of it.
    if (withMalEntries.length > 0) upsertAnilistCatalogFields(withMalEntries);
    const { minted, resolved: alreadyAnchored } = anilistOnlyIds.length > 0
      ? resolveCanonicalIds(anilistOnlyIds.map(id => ({ anilist: id })))
      : { minted: 0, resolved: 0 };

    appendLog(
      'anilist-catalog-crawl',
      'success',
      `AniList catalog crawl complete: ${withMalEntries.length} with MAL id enriched, ${minted} AniList-only canonical ids minted (${alreadyAnchored} already anchored)`,
      { pagesFetched, withMal: withMalEntries.length, anilistOnlyMinted: minted, anilistOnlyAlreadyAnchored: alreadyAnchored }
    );

    return {
      ok: true,
      alreadyRunning: false,
      season: resolvedSeason,
      seasonYear: resolvedYear,
      pagesFetched,
      withMal: withMalEntries.length,
      anilistOnlyMinted: minted,
      anilistOnlyAlreadyAnchored: alreadyAnchored,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('AniList catalog crawl error:', error);
    appendLog('anilist-catalog-crawl', 'error', 'AniList catalog crawl failed', { error: message });
    return { ok: false, alreadyRunning: false, season: resolvedSeason, seasonYear: resolvedYear, pagesFetched: 0, withMal: 0, anilistOnlyMinted: 0, anilistOnlyAlreadyAnchored: 0, error: message };
  } finally {
    isAnilistCatalogCrawlRunning = false;
  }
}

/** Registry-wide stats for the connections-page crawl button (canonical id counts by anchoring). */
export function getAnilistCatalogCrawlStats(): { totalCanonicalIds: number; anilistOnlyIds: number } {
  const registry = getRegistry();
  const entries = Object.values(registry);
  const anilistOnlyIds = entries.filter(ids => ids.mal === undefined && ids.anilist !== undefined).length;
  return { totalCanonicalIds: entries.length, anilistOnlyIds };
}
