/**
 * AniList catalog-metadata sync. Public GraphQL API, no auth. Pulls the tag
 * taxonomy, the top staff credits, the banner art and the franchise relation
 * edges for every anime the **registry** knows of — by MAL id where there is
 * one, by AniList id otherwise. Read-only against AniList; no writes.
 */
import { getAllAnilistMeta, upsertAnilistMeta, upsertAnilistCatalogFields, resolveCanonicalIds, getRegistry, toNum } from '@/lib/store';
import { appendLog } from '@/lib/config/connectionLog';
import { anilistQuery } from '@/lib/providers/anilist/client';
import { getSeasonInfos } from '@/lib/domain/animeUtils';
import { AniListTagEntry, AniListStaffEntry, AniListMetaEntry, AniListRelationEntry } from '@/models/anime';

const BATCH_SIZE = 50;
// Top-relevance staff credits to keep per anime — enough for the discriminative
// creative roles (director, character design, music…) without bloating storage.
const STAFF_PER_ANIME = 15;

// Tags, staff AND relations in one query per batch. `perPage:50` with nested
// `staff(perPage:15)` plus the relations connection stays under AniList's
// query-complexity ceiling; adding to it may not.
//
// Staff must stay nested inside `Page.media` — an aliased `Media` null-bombs on
// any miss. `relations.node.type` is fetched because an ADAPTATION edge's
// `idMal` is the MANGA's id and would otherwise be read as an unrelated anime.
//
// The body is built with `idMal_in` OR `id_in` — the same filter over each id
// space, so a title with no MAL id is still reachable by its AniList id.
// `selectMetaTargets` picks per title, and a batch is never mixed: AniList
// applies a supplied-but-null argument as a real filter (see cast.ts), so a
// query carries exactly one id filter.
type MetaIdField = 'idMal_in' | 'id_in';
/** Which provider's id space a batch of enrichment ids lives in. */
export type MetaIdSpace = 'mal' | 'anilist';

const buildTagsQuery = (idField: MetaIdField) => `
query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    media(${idField}: $ids, type: ANIME) {
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
      relations {
        edges {
          relationType
          node { id idMal type }
        }
      }
    }
  }
}`;

const TAGS_QUERY_BY_MAL = buildTagsQuery('idMal_in');
const TAGS_QUERY_BY_ANILIST = buildTagsQuery('id_in');

interface RawStaffEdge {
  role?: string;
  node?: { id?: number; name?: { full?: string } };
}
interface RawRelationEdge {
  relationType?: string;
  node?: { id?: number | null; idMal?: number | null; type?: string };
}
interface RawMedia {
  /** Null for an AniList-only title — the case the `id_in` path exists to serve. */
  idMal?: number | null;
  id: number;
  bannerImage?: string | null;
  tags: AniListTagEntry[];
  staff?: { edges?: RawStaffEdge[] };
  relations?: { edges?: RawRelationEdge[] };
}

/**
 * One AniList media node -> our stored entry. `banner_image` is coerced to an
 * explicit `null` when AniList has none, so `undefined` keeps meaning "never
 * fetched" and stays usable as the backfill signal. `mal_id` is left `undefined`
 * for an AniList-only title, which is what `upsertAnilistMeta` then resolves
 * off the `anilist` crosswalk alone.
 */
function toEntry(m: RawMedia, fetchedAt: string): AniListMetaEntry {
  return {
    mal_id: m.idMal ?? undefined,
    anilist_id: m.id,
    tags: m.tags ?? [],
    staff: parseStaff(m),
    banner_image: m.bannerImage ?? null,
    relations: parseRelations(m),
    fetched_at: fetchedAt,
  };
}

/**
 * Flatten AniList relation edges, keeping BOTH join keys. Non-ANIME targets are
 * dropped: an ADAPTATION edge points at the source manga, whose `idMal` lives in
 * a different id space and would otherwise be matched against an anime.
 *
 * Keeping both keys matters — requiring `idMal` would drop every edge into an
 * AniList-only title, silently costing the franchise graph. The AniList id is
 * always present (the edge came from AniList), so the only reason to drop an
 * edge is that its target is not an anime.
 */
function parseRelations(media: RawMedia): AniListRelationEntry[] {
  return (media.relations?.edges ?? [])
    .filter((e): e is RawRelationEdge & { relationType: string; node: { id: number } } =>
      !!e.relationType && e.node?.type === 'ANIME' && typeof e.node?.id === 'number')
    .map(e => ({
      idMal: typeof e.node.idMal === 'number' ? e.node.idMal : undefined,
      id: e.node.id,
      relationType: e.relationType,
    }));
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

/**
 * One enrichment batch. `by` picks the id space the `ids` are in — `'mal'` for
 * MAL ids (the overwhelming majority of the catalog), `'anilist'` for titles
 * that have no MAL id. A batch is homogeneous by construction (see the query).
 */
async function fetchTagsBatch(ids: number[], by: MetaIdSpace): Promise<RawMedia[]> {
  const data = await anilistQuery<{ Page?: { media?: RawMedia[] } }>(
    by === 'mal' ? TAGS_QUERY_BY_MAL : TAGS_QUERY_BY_ANILIST,
    { ids }
  );
  return data?.Page?.media ?? [];
}

// Crowd recommendations query — kept SEPARATE from TAGS_QUERY (tags + staff
// already sit near AniList's query-complexity ceiling; stacking a
// recommendations connection on top risks blowing it). Lightweight: only idMal
// + the recommendations edge. `mediaRecommendation.idMal` resolves the rec
// straight back onto our MAL join key, so no crosswalk is needed.
//
// This query stays MAL-keyed on purpose, unlike the enrichment one above: its
// only consumer is the reco engine, which is MAL-keyed end to end (seeds, crowd
// edges and cache/recommendations.json are all MAL ids). An `id_in` path here
// would return edges the engine has no key to store or rank.
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

async function fetchRecsBatch(malIds: number[]): Promise<RawRecMedia[]> {
  const data = await anilistQuery<{ Page?: { media?: RawRecMedia[] } }>(RECS_QUERY, { ids: malIds });
  return data?.Page?.media ?? [];
}

/**
 * Fetch AniList crowd recommendations for the given seed MAL ids, batched by 50
 * (throttled by `client.ts` like every other AniList call). Returns a map of
 * seed MAL id -> recommended
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

let anilistMetaSyncRunning = false;

/**
 * Is a metadata sync in flight? The sync is normally fire-and-forget (it can run
 * for minutes and reports through `appendLog`), so a caller that starts one
 * without awaiting has no other way to tell "started" from "one was already
 * going" — which is exactly what cron-sync reports per provider. Same shape as
 * `isRecommendationsRefreshRunning` and the catalog crawl's `crawlRunning`.
 */
export function isAnilistMetaSyncRunning(): boolean {
  return anilistMetaSyncRunning;
}

/**
 * Which titles still need enrichment, split by the id space they can be queried
 * in.
 *
 * **The scan source must be the registry, not the MAL catalog slice** — the
 * latter cannot even name a title MAL doesn't know, which would leave every
 * record minted by the keyless AniList crawl permanently un-enrichable. The
 * registry is the identity spine every slice hangs off, so iterating it is what
 * makes "every title we know of" mean every title.
 *
 * A title is queued when it has no AniList entry yet, OR an entry missing
 * staff / banner / relations (field === `undefined`) so those backfill onto
 * already-tagged titles. Absent values are stored as `null`/`[]` rather than
 * left undefined, so a title AniList genuinely lacks never re-queues.
 *
 * MAL id wins when a title has both: it is the join key the catalog is anchored
 * on, and the crosswalk's `anilist` id can be a mirrored SIMKL value, whereas
 * `mal` is the id the record was built from.
 */
function selectMetaTargets(): { malIds: number[]; anilistIds: number[] } {
  const meta = getAllAnilistMeta();
  const malIds: number[] = [];
  const anilistIds: number[] = [];

  for (const [canonicalId, crosswalk] of Object.entries(getRegistry())) {
    const e = meta[canonicalId];
    const needed = !e || e.staff === undefined || e.banner_image === undefined || e.relations === undefined;
    if (!needed) continue;
    const malId = toNum(crosswalk.mal);
    if (malId !== undefined) {
      malIds.push(malId);
      continue;
    }
    const anilistId = toNum(crosswalk.anilist);
    if (anilistId !== undefined) anilistIds.push(anilistId);
    // Neither id: a SIMKL-only title AniList has no handle on.
  }

  return { malIds, anilistIds };
}

/**
 * Force-refresh AniList tags + staff + banner + relations for specific ids,
 * bypassing the "missing only" filter that `performAnilistMetaSync` uses. Powers
 * the per-anime refresh on the detail page. One batch, no throttle loop (the
 * caller passes few ids). Returns how many ids AniList actually had — it
 * silently skips ones it doesn't know.
 *
 * `by` selects the id space, since the caller may hold only one of the two: a
 * title with no MAL id is refreshed by its AniList id.
 */
export async function refreshAnilistMetaForIds(
  ids: number[],
  by: MetaIdSpace = 'mal'
): Promise<{ ok: boolean; tagged: number; error?: string }> {
  const batch = ids.filter(id => Number.isInteger(id)).slice(0, BATCH_SIZE);
  if (batch.length === 0) return { ok: true, tagged: 0 };
  try {
    const media = await fetchTagsBatch(batch, by);
    const now = new Date().toISOString();
    // Keyed on `m.id` (AniList's own, always present) rather than `m.idMal` —
    // filtering on the MAL id here would discard exactly the AniList-only
    // titles this path exists for.
    const entries: AniListMetaEntry[] = media.filter(m => m.id).map(m => toEntry(m, now));
    if (entries.length > 0) upsertAnilistMeta(entries);
    return { ok: true, tagged: entries.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    appendLog('anilist-meta-sync', 'error', `AniList refresh failed for ${by} ids ${batch.join(',')}: ${message}`);
    return { ok: false, tagged: 0, error: message };
  }
}

export async function performAnilistMetaSync(): Promise<AniListMetaSyncResult> {
  if (anilistMetaSyncRunning) {
    appendLog('anilist-meta-sync', 'info', 'AniList metadata sync skipped: already running');
    return { ok: false, alreadyRunning: true, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
  }

  anilistMetaSyncRunning = true;
  try {
    const { malIds, anilistIds } = selectMetaTargets();
    const totalMissing = malIds.length + anilistIds.length;

    if (totalMissing === 0) {
      appendLog('anilist-meta-sync', 'success', 'AniList sync: nothing to do, all anime already have tags + staff');
      return { ok: true, alreadyRunning: false, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
    }

    appendLog(
      'anilist-meta-sync',
      'info',
      `AniList metadata sync started: ${totalMissing} anime to fetch (${malIds.length} by MAL id, ${anilistIds.length} by AniList id)`,
      { byMalId: malIds.length, byAnilistId: anilistIds.length }
    );

    // Two id spaces, one stream — a batch is homogeneous (AniList treats a
    // supplied-but-null filter argument as real), but the counters span both.
    // Pacing is `client.ts`'s job, shared with every other AniList caller.
    const batches: Array<{ ids: number[]; by: MetaIdSpace }> = [
      ...chunk(malIds, BATCH_SIZE).map(ids => ({ ids, by: 'mal' as const })),
      ...chunk(anilistIds, BATCH_SIZE).map(ids => ({ ids, by: 'anilist' as const })),
    ];
    let processed = 0;
    let tagged = 0;
    let failed = 0;

    for (const [batchIndex, { ids: batch, by }] of batches.entries()) {
      try {
        const media = await fetchTagsBatch(batch, by);
        const now = new Date().toISOString();
        const entries: AniListMetaEntry[] = media.filter(m => m.id).map(m => toEntry(m, now));
        if (entries.length > 0) {
          upsertAnilistMeta(entries);
          tagged += entries.length;
        }
        processed += batch.length;
        appendLog('anilist-meta-sync', 'info', `AniList tags: ${processed}/${totalMissing} processed`, {
          processed,
          totalMissing,
          tagged,
        });
      } catch (error) {
        failed += batch.length;
        processed += batch.length;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`AniList tags batch ${batchIndex + 1}/${batches.length} error (${by} ids ${batch[0]}-${batch[batch.length - 1]}):`, error);
        appendLog(
          'anilist-meta-sync',
          'error',
          `AniList tags batch ${batchIndex + 1}/${batches.length} failed, continuing: ${errorMessage}`,
          {
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            batchSize: batch.length,
            idSpace: by,
            ids: batch,
            error: errorMessage,
          }
        );
      }
    }

    appendLog('anilist-meta-sync', 'success', `AniList metadata sync complete: ${tagged} tagged, ${failed} failed`, {
      processed,
      tagged,
      failed,
    });

    return { ok: true, alreadyRunning: false, totalMissing, processed, tagged, failed };
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
    anilistMetaSyncRunning = false;
  }
}

// ============================================================================
// AniList catalog crawler
// ============================================================================
//
// Unlike the tags/staff sync above (which enriches titles already known via
// `catalog/mal.json`), this browses AniList's OWN catalog by season — the
// capability that lets AniList seed the registry INDEPENDENTLY of MAL, with no
// account and no key.
//
// Titles found WITH a MAL id enrich the existing AniList meta entry (`catalog`
// block, merged not overwritten — see `upsertAnilistCatalogFields`). Titles
// found WITHOUT one still get their `catalog` block persisted, keyed off the
// `anilist` crosswalk alone. `getAnimeForDisplay` unions in every canonical id
// anchored this way, so an AniList-only title carrying an `idMal` renders a full
// row through provenance hydration; a title with no `idMal` anywhere is skipped
// at the row-set level, not here.

// The catalog field set, shared by the season crawler and the by-MAL-id
// hydration path below so the two can never drift into producing differently
// shaped rows for the same title.
const CATALOG_FIELDS = `
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
      studios { nodes { id name } }`;

const CATALOG_QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: ${BATCH_SIZE}) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, type: ANIME) {${CATALOG_FIELDS}
    }
  }
}`;

const CATALOG_BY_MAL_QUERY = `
query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    media(idMal_in: $ids, type: ANIME) {${CATALOG_FIELDS}
    }
  }
}`;

// The catalog sweep's query — same fields, filtered by AniList's OWN id. This is
// the id-space policy in code: a title whose AniList id we already hold is
// enriched THROUGH that id, never bridged back through MAL's. Sibling of
// CATALOG_BY_MAL_QUERY, which stays for the keyless reco-hydration path (whose
// candidates arrive as MAL ids with no crosswalk entry yet).
const CATALOG_BY_ANILIST_QUERY = `
query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    media(id_in: $ids, type: ANIME) {${CATALOG_FIELDS}
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

/**
 * One AniList catalog media node → a storable entry, normalized to MAL's
 * vocabulary. `null` when the title has no usable name (nothing to render).
 *
 * Shared by the season crawler and by `fetchAnilistCatalogByMalIds` — the
 * keyless hydration path for reco candidates. Both need AniList's catalog view
 * of a title in exactly the same shape; only the *query* that finds the media
 * differs (by season vs. by MAL id).
 */
function toCatalogEntry(m: RawCatalogMedia): AniListCatalogEntry | null {
  const title = m.title?.english || m.title?.romaji;
  if (!title) return null;
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
  return m.idMal
    ? { mal_id: m.idMal, anilist_id: m.id, catalog }
    : { anilist_id: m.id, catalog };
}

async function fetchCatalogPage(season: string, seasonYear: number, page: number): Promise<RawCatalogPage> {
  const data = await anilistQuery<{ Page?: RawCatalogPage }>(CATALOG_QUERY, { season, seasonYear, page });
  return data?.Page ?? { media: [] };
}

/**
 * Fetch AniList's catalog view of specific MAL ids and persist it — the
 * **keyless hydration path** for recommendation candidates.
 *
 * `performRecommendationsRefresh` hydrates candidate titles missing from the
 * local catalog so the feed has something to rank. This is the keyless path for
 * that: candidates arrive as MAL ids (the reco engine's join key) and AniList
 * queries by MAL id happily, so no crosswalk is involved and no MAL account is
 * needed. Without it a user with no MAL account accumulates AniList crowd edges
 * and renders none of them.
 *
 * Persists through `upsertAnilistCatalogFields`, so a hydrated title lands as a
 * `catalog` block on the AniList meta slice and renders through the normal
 * provenance hydration — exactly like a title the season crawler found. Titles
 * AniList doesn't know are silently skipped. Batched by 50, on the shared
 * `client.ts` throttle like every other sweep here.
 */
export async function fetchAnilistCatalogByMalIds(
  malIds: number[],
  onBatch?: (done: number, total: number) => void
): Promise<{ requested: number; hydrated: number; failed: number }> {
  const ids = malIds.filter(id => Number.isInteger(id));
  const batches = chunk(ids, BATCH_SIZE);
  let processed = 0;
  let hydrated = 0;
  let failed = 0;

  for (const batch of batches) {
    try {
      const data = await anilistQuery<{ Page?: { media?: RawCatalogMedia[] } }>(
        CATALOG_BY_MAL_QUERY,
        { ids: batch }
      );
      const entries = (data?.Page?.media ?? [])
        .map(toCatalogEntry)
        .filter((e): e is AniListCatalogEntry => e !== null);
      if (entries.length > 0) {
        resolveCanonicalIds(entries.map(e => ({ mal: e.mal_id, anilist: e.anilist_id })));
        upsertAnilistCatalogFields(entries);
        hydrated += entries.length;
      }
    } catch (error) {
      failed += batch.length;
      const message = error instanceof Error ? error.message : 'Unknown error';
      appendLog('anilist-meta-sync', 'error', `AniList catalog hydration batch failed, continuing: ${message}`);
    }
    processed += batch.length;
    if (onBatch) onBatch(processed, ids.length);
  }

  return { requested: ids.length, hydrated, failed };
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

type AniListCatalogEntry = { mal_id?: number; anilist_id: number; catalog: NonNullable<AniListMetaEntry['catalog']> };

interface SeasonCrawlOutcome {
  entries: AniListCatalogEntry[];
  pagesFetched: number;
  withMal: number;
  anilistOnly: number;
}

/**
 * Fetch + map one season's pages (popularity-descending, ≤`maxPages` × 50
 * titles). No persistence and no lock — callers own both. `logPages` is off in
 * the bulk crawl so 30+ seasons don't flood the 500-entry connection log.
 */
async function crawlCatalogSeason(season: string, seasonYear: number, maxPages: number, logPages: boolean): Promise<SeasonCrawlOutcome> {
  const entries: AniListCatalogEntry[] = [];
  let withMal = 0;
  let anilistOnly = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const result = await fetchCatalogPage(season, seasonYear, page);
    pagesFetched++;

    for (const m of result.media ?? []) {
      const entry = toCatalogEntry(m);
      if (!entry) continue;
      entries.push(entry);
      // No MAL id: the catalog block is still persisted, keyed off the `anilist`
      // crosswalk alone — this is what lets an AniList-only title render a row.
      if (entry.mal_id !== undefined) withMal++; else anilistOnly++;
    }

    if (logPages) appendLog('anilist-catalog-crawl', 'info', `AniList catalog: page ${page}/${maxPages} fetched`, { page, maxPages });

    if (!result.pageInfo?.hasNextPage) break;
  }

  return { entries, pagesFetched, withMal, anilistOnly };
}

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

    const { entries: catalogEntries, pagesFetched, withMal: withMalCount, anilistOnly: anilistOnlyCount } =
      await crawlCatalogSeason(resolvedSeason, resolvedYear, maxPages, true);

    // Resolve first (ourselves) purely to capture mint/resolve counts for
    // logging — upsertAnilistCatalogFields resolves-before-mint internally too,
    // and re-resolving the same crosswalks here is idempotent (no double mint).
    // Both with-MAL and AniList-only entries now persist their `catalog` block
    // under the canonical key, registering the crosswalk — the registry is the
    // identity spine, and this crawl is a first-class writer of it.
    const { minted, resolved: alreadyAnchored } = catalogEntries.length > 0
      ? resolveCanonicalIds(catalogEntries.map(e => ({ mal: e.mal_id, anilist: e.anilist_id })))
      : { minted: 0, resolved: 0 };
    if (catalogEntries.length > 0) upsertAnilistCatalogFields(catalogEntries);

    appendLog(
      'anilist-catalog-crawl',
      'success',
      `AniList catalog crawl complete: ${withMalCount} with MAL id enriched, ${anilistOnlyCount} AniList-only titles hydrated (${minted} canonical ids minted, ${alreadyAnchored} already anchored)`,
      { pagesFetched, withMal: withMalCount, anilistOnlyMinted: minted, anilistOnlyAlreadyAnchored: alreadyAnchored }
    );

    return {
      ok: true,
      alreadyRunning: false,
      season: resolvedSeason,
      seasonYear: resolvedYear,
      pagesFetched,
      withMal: withMalCount,
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

export interface AniListBulkCatalogCrawlResult {
  ok: boolean;
  alreadyRunning: boolean;
  totalSeasons: number;
  seasonsCrawled: number;
  seasonsFailed: number;
  withMal: number;
  anilistOnly: number;
  minted: number;
  error?: string;
}

const SEASON_SEQUENCE = ['winter', 'spring', 'summer', 'fall'] as const;
// Mirrors MAL big-sync's backward window (8 years); forward stops at the NEXT
// season — AniList seasons further out are too sparse to be worth a request.
const BULK_CRAWL_YEARS_BACK = 8;

/** Seasons from NEXT season back through winter of `yearsBack` years ago, newest first. */
function listBulkCrawlSeasons(yearsBack: number): Array<{ season: string; year: number }> {
  const { current, next } = getSeasonInfos();
  const stopYear = current.year - yearsBack;
  const seasons: Array<{ season: string; year: number }> = [];
  let year = next.year;
  let idx = SEASON_SEQUENCE.indexOf(next.season as (typeof SEASON_SEQUENCE)[number]);
  for (;;) {
    seasons.push({ season: SEASON_SEQUENCE[idx], year });
    if (year === stopYear && idx === 0) break;
    idx -= 1;
    if (idx < 0) { idx = SEASON_SEQUENCE.length - 1; year -= 1; }
  }
  return seasons;
}

/**
 * First-run bulk crawl: the last `yearsBack` years of seasons, newest first (so
 * the default current-season view fills as early as possible), each capped at
 * `maxPagesPerSeason` pages — the popularity head of every season, not
 * AniList's full tail. Persists after EVERY season, so a mid-crawl failure
 * keeps everything already fetched, and a per-season failure is non-fatal.
 * Progress surfaces via appendLog `{seasonIndex, totalSeasons}` detail, polled
 * by the first-run onboarding panel through /api/anime/connection-log.
 */
export async function performAnilistBulkCatalogCrawl(
  yearsBack = BULK_CRAWL_YEARS_BACK,
  maxPagesPerSeason = 3
): Promise<AniListBulkCatalogCrawlResult> {
  const seasons = listBulkCrawlSeasons(yearsBack);

  if (isAnilistCatalogCrawlRunning) {
    appendLog('anilist-catalog-crawl', 'info', 'AniList bulk catalog crawl skipped: already running');
    return { ok: false, alreadyRunning: true, totalSeasons: seasons.length, seasonsCrawled: 0, seasonsFailed: 0, withMal: 0, anilistOnly: 0, minted: 0 };
  }

  isAnilistCatalogCrawlRunning = true;
  let seasonsCrawled = 0;
  let seasonsFailed = 0;
  let withMal = 0;
  let anilistOnly = 0;
  let minted = 0;
  try {
    const oldest = seasons[seasons.length - 1];
    const newest = seasons[0];
    appendLog(
      'anilist-catalog-crawl',
      'info',
      `AniList bulk catalog crawl started: ${seasons.length} seasons (${oldest.season} ${oldest.year} → ${newest.season} ${newest.year})`,
      { totalSeasons: seasons.length }
    );

    for (let i = 0; i < seasons.length; i++) {
      const { season, year } = seasons[i];
      try {
        const result = await crawlCatalogSeason(season.toUpperCase(), year, maxPagesPerSeason, false);
        const counts = result.entries.length > 0
          ? resolveCanonicalIds(result.entries.map(e => ({ mal: e.mal_id, anilist: e.anilist_id })))
          : { minted: 0, resolved: 0 };
        if (result.entries.length > 0) upsertAnilistCatalogFields(result.entries);
        seasonsCrawled++;
        withMal += result.withMal;
        anilistOnly += result.anilistOnly;
        minted += counts.minted;
        appendLog(
          'anilist-catalog-crawl',
          'info',
          `AniList catalog: season ${i + 1}/${seasons.length} (${season} ${year}) — ${result.entries.length} titles`,
          { seasonIndex: i + 1, totalSeasons: seasons.length, season, year, titles: result.entries.length }
        );
      } catch (error) {
        // Non-fatal: one bad season (transient AniList hiccup) must not abort a
        // 30+ season first-run crawl. Logged at info level — an error-level
        // entry is the onboarding panel's fatal signal.
        seasonsFailed++;
        const message = error instanceof Error ? error.message : 'Unknown error';
        appendLog(
          'anilist-catalog-crawl',
          'info',
          `AniList catalog: season ${season} ${year} failed, continuing`,
          { seasonIndex: i + 1, totalSeasons: seasons.length, season, year, error: message }
        );
      }
    }

    if (seasonsCrawled === 0) {
      appendLog('anilist-catalog-crawl', 'error', `AniList bulk catalog crawl failed: all ${seasons.length} seasons errored`);
      return { ok: false, alreadyRunning: false, totalSeasons: seasons.length, seasonsCrawled, seasonsFailed, withMal, anilistOnly, minted, error: 'All seasons failed' };
    }

    appendLog(
      'anilist-catalog-crawl',
      'success',
      `AniList bulk catalog crawl complete: ${seasonsCrawled}/${seasons.length} seasons, ${withMal + anilistOnly} titles (${minted} canonical ids minted)${seasonsFailed > 0 ? `, ${seasonsFailed} seasons failed` : ''}`,
      { totalSeasons: seasons.length, seasonsCrawled, seasonsFailed, withMal, anilistOnly, minted }
    );
    return { ok: true, alreadyRunning: false, totalSeasons: seasons.length, seasonsCrawled, seasonsFailed, withMal, anilistOnly, minted };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('AniList bulk catalog crawl error:', error);
    appendLog('anilist-catalog-crawl', 'error', 'AniList bulk catalog crawl failed', { error: message });
    return { ok: false, alreadyRunning: false, totalSeasons: seasons.length, seasonsCrawled, seasonsFailed, withMal, anilistOnly, minted, error: message };
  } finally {
    isAnilistCatalogCrawlRunning = false;
  }
}

/**
 * Registry-wide stats for the connections-page crawl button and the first-run
 * onboarding gate (`totalCanonicalIds === 0` = genuinely empty store).
 */
export function getAnilistCatalogCrawlStats(): { totalCanonicalIds: number; anilistOnlyIds: number; crawlRunning: boolean } {
  const registry = getRegistry();
  const entries = Object.values(registry);
  const anilistOnlyIds = entries.filter(ids => ids.mal === undefined && ids.anilist !== undefined).length;
  return { totalCanonicalIds: entries.length, anilistOnlyIds, crawlRunning: isAnilistCatalogCrawlRunning };
}

// ============================================================================
// AniList catalog SWEEP — backfill the `catalog` block on already-known titles
// ============================================================================
//
// The season crawler above browses AniList's OWN catalog to DISCOVER titles; the
// SWEEP instead enriches titles the registry ALREADY knows, filling the one
// AniList slice a MAL-seeded store never populated — the `catalog` block (title,
// synopsis, mean, genres, studios, …). Until it runs, catalog precedence has no
// AniList value to weigh against MAL's, so every field falls through to MAL for
// lack of an alternative (the whole reason the sweep is the "spine" of
// docs/FULL Precedence/).
//
// **Queries AniList by ITS OWN id**, read from the crosswalk — the id-space
// policy in code. A title with no AniList id is simply not swept; coverage there
// is the season crawl's job, never a MAL-id bridge's. That is why this does NOT
// reuse the MAL-keyed `fetchAnilistCatalogByMalIds` (kept for the keyless reco
// hydration path, whose candidates arrive as bare MAL ids).

let catalogSweepRunning = false;

/**
 * Is a catalog sweep in flight? Mirrors `isAnilistMetaSyncRunning` — the sweep is
 * fire-and-forget, so a non-awaiting caller (the cron step, the endpoint) needs a
 * way to tell "started" from "one was already going".
 */
export function isAnilistCatalogSweepRunning(): boolean {
  return catalogSweepRunning;
}

/**
 * AniList ids of titles still missing a `catalog` block. Backfill signal is
 * `catalog === undefined` (no entry at all counts too). The scan source is the
 * **registry**, not the MAL slice, for the same reason `selectMetaTargets` uses
 * it — a title MAL doesn't know can still have an AniList id worth sweeping.
 *
 * A title with no AniList id in the crosswalk is skipped, not bridged through a
 * MAL id: that is the id-space policy, and it is why this selector is separate
 * from `selectMetaTargets` (which still routes by MAL id, its own open item E-line).
 */
function selectCatalogSweepTargets(): number[] {
  const meta = getAllAnilistMeta();
  const anilistIds: number[] = [];
  for (const [canonicalId, crosswalk] of Object.entries(getRegistry())) {
    const e = meta[canonicalId];
    if (e && e.catalog !== undefined) continue; // already swept
    const anilistId = toNum(crosswalk.anilist);
    if (anilistId !== undefined) anilistIds.push(anilistId);
  }
  return anilistIds;
}

export interface AniListCatalogSweepResult {
  ok: boolean;
  alreadyRunning: boolean;
  totalMissing: number;
  processed: number;
  hydrated: number;
  failed: number;
  error?: string;
}

/**
 * Backfill the AniList `catalog` block for every registry title that holds an
 * AniList id but no catalog data yet. Fire-and-forget, throttled by `client.ts`,
 * **resumable by construction**: each batch persists as it lands
 * (`upsertAnilistCatalogFields`) and only un-swept titles re-queue, so an
 * interrupted ~15-20 min run loses nothing. Progress goes to the
 * `anilist-catalog-sweep` log channel, polled by the connections panel.
 */
export async function performAnilistCatalogSweep(): Promise<AniListCatalogSweepResult> {
  if (catalogSweepRunning) {
    appendLog('anilist-catalog-sweep', 'info', 'AniList catalog sweep skipped: already running');
    return { ok: false, alreadyRunning: true, totalMissing: 0, processed: 0, hydrated: 0, failed: 0 };
  }

  catalogSweepRunning = true;
  try {
    const targets = selectCatalogSweepTargets();
    const totalMissing = targets.length;

    if (totalMissing === 0) {
      appendLog('anilist-catalog-sweep', 'success', 'AniList catalog sweep: nothing to do, every known title already has a catalog block');
      return { ok: true, alreadyRunning: false, totalMissing: 0, processed: 0, hydrated: 0, failed: 0 };
    }

    appendLog('anilist-catalog-sweep', 'info', `AniList catalog sweep started: ${totalMissing} titles to enrich by AniList id`, { totalMissing });

    const batches = chunk(targets, BATCH_SIZE);
    let processed = 0;
    let hydrated = 0;
    let failed = 0;

    for (const [batchIndex, batch] of batches.entries()) {
      try {
        const data = await anilistQuery<{ Page?: { media?: RawCatalogMedia[] } }>(
          CATALOG_BY_ANILIST_QUERY,
          { ids: batch }
        );
        const entries = (data?.Page?.media ?? [])
          .map(toCatalogEntry)
          .filter((e): e is AniListCatalogEntry => e !== null);
        if (entries.length > 0) {
          // Register the crosswalk (idempotent — the id already resolves), then
          // persist THIS batch so the run is resumable mid-sweep.
          resolveCanonicalIds(entries.map(e => ({ mal: e.mal_id, anilist: e.anilist_id })));
          upsertAnilistCatalogFields(entries);
          hydrated += entries.length;
        }
      } catch (error) {
        failed += batch.length;
        const message = error instanceof Error ? error.message : 'Unknown error';
        appendLog(
          'anilist-catalog-sweep',
          'error',
          `AniList catalog sweep batch ${batchIndex + 1}/${batches.length} failed, continuing: ${message}`,
          { batchIndex: batchIndex + 1, batchCount: batches.length, error: message }
        );
      }
      processed += batch.length;
      // Every 10th batch (and the last) — ~386 batches would otherwise flood the
      // 500-entry log. The panel polls the newest entry, so coarse is fine.
      if ((batchIndex + 1) % 10 === 0 || batchIndex === batches.length - 1) {
        appendLog('anilist-catalog-sweep', 'info', `AniList catalog sweep: ${processed}/${totalMissing} processed`, {
          processed,
          totalMissing,
          hydrated,
        });
      }
    }

    appendLog('anilist-catalog-sweep', 'success', `AniList catalog sweep complete: ${hydrated} enriched, ${failed} failed`, {
      processed,
      hydrated,
      failed,
    });
    return { ok: true, alreadyRunning: false, totalMissing, processed, hydrated, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('AniList catalog sweep error:', error);
    appendLog('anilist-catalog-sweep', 'error', 'AniList catalog sweep failed', { error: message });
    return { ok: false, alreadyRunning: false, totalMissing: 0, processed: 0, hydrated: 0, failed: 0, error: message };
  } finally {
    catalogSweepRunning = false;
  }
}

/**
 * Coverage stat for the connections-page sweep button: how many known titles
 * carry a catalog block vs. the total, plus whether a sweep is in flight.
 */
export function getAnilistCatalogSweepStats(): { totalEntries: number; catalogCount: number; sweepRunning: boolean } {
  const meta = getAllAnilistMeta();
  let catalogCount = 0;
  for (const entry of Object.values(meta)) {
    if (entry.catalog !== undefined) catalogCount++;
  }
  return { totalEntries: Object.keys(meta).length, catalogCount, sweepRunning: catalogSweepRunning };
}
