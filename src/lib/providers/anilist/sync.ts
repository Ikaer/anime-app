/**
 * AniList catalog-metadata sync. Public GraphQL API, no auth. Pulls the tag
 * taxonomy, the top staff credits, the banner art and the franchise relation
 * edges for every anime the **registry** knows of — **by AniList's own id, and
 * only by it**. Read-only against AniList; no writes.
 *
 * The id-space policy (docs/DECISIONS.md, E8): AniList methods take AniList
 * ids out of the crosswalk. A title with no AniList id is simply not enriched;
 * finding one is the *season crawl's* job, never a `Media(idMal:)` bridge's.
 */
import { getAllAnilistMeta, upsertAnilistMeta, upsertAnilistCatalogFields, resolveCanonicalIds, getRegistry, toNum } from '@/lib/store';
import { appendLog } from '@/lib/config/connectionLog';
import { anilistQuery } from '@/lib/providers/anilist/client';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { getSeasonInfos } from '@/lib/domain/animeUtils';
import { AniListTagEntry, AniListStaffEntry, AniListMetaEntry, AniListRelationEntry } from '@/models/anime';

const BATCH_SIZE = 50;
// Top-relevance staff credits per anime, as PAGES rather than one number, because
// **25 is AniList's hard cap on this connection** — asking `perPage: 50` returns
// 25 anyway (verified live 2026-07-25), so more depth can only come from more
// pages. Two pages ⇒ up to 50 credits.
//
// 15 (the original) truncated 35% of the store's ~19k entries and cut real
// credits, not just noise: AniList's RELEVANCE sort is only loosely
// importance-first — on AniList 8407 the Theme Song Composition, Art Setting and
// ADR Director credits sit at ranks 30-35, *below* per-episode key animation.
// Measured over a 200-title sample of the live store, titles fully covered:
// 67.5% at 15, 75.0% at 25, 84.5% at 50. The remaining tail is blockbusters with
// hundreds of per-episode animation credits; a third page is not worth another
// slab of a slice that sits in the seven-slice join.
//
// **Do NOT trust `staff.pageInfo.total` on page 1** — it reports a placeholder
// (500/lastPage 20 for a title that actually has 40). Only the LAST page's
// pageInfo is truthful, which is why coverage above was measured by walking
// pages, never by reading `total`.
const STAFF_PER_PAGE = 25;

/**
 * The aliased staff pages, in order. `satisfies` ties them to `RawMedia`'s
 * fields, so adding a third page is "add the key here, add the field there" and
 * a typo is a compile error rather than a silently-dropped page.
 */
const STAFF_PAGE_KEYS = ['staffPage1', 'staffPage2'] as const satisfies readonly (keyof RawMedia)[];

/** One aliased page of the staff connection, `staffPage1`, `staffPage2`, … */
function staffPageField(page: number): string {
  return `staffPage${page}: staff(sort: RELEVANCE, page: ${page}, perPage: ${STAFF_PER_PAGE}) {
        edges {
          role
          node {
            id
            name { full }
          }
        }
      }`;
}

// Tags, staff AND relations in one query per batch. `perPage:50` media with TWO
// nested aliased `staff(perPage:25)` connections plus relations stays under
// AniList's query-complexity ceiling — verified live at exactly this shape
// (HTTP 200, 50/50 media returned, no null pages); adding to it may not.
//
// The staff pages are ALIASED FIELDS on the media node (`staffPage1`/`staffPage2`),
// which is a different thing from the aliased-`Media` null bomb warned about
// below: that hazard is aliasing the top-level single-media root, not aliasing a
// connection inside `Page.media`. Verified live — every sampled title populated
// both aliases.
//
// Staff must stay nested inside `Page.media` — an aliased `Media` null-bombs on
// any miss. `relations.node.type` is fetched because an ADAPTATION edge's
// `idMal` is the MANGA's id and would otherwise be read as an unrelated anime.
//
// **One id filter, `id_in`, and no MAL-keyed twin.** The query used to be built
// over `idMal_in` OR `id_in` with `selectMetaTargets` routing per title and MAL
// winning whenever it had an id — a foreign key used as AniList's primary lookup
// key. E8 removed that branch: `idMal` is still SELECTED (AniList declaring its
// own crosswalk, as data — that half is reconciliation and stays), it is simply
// never a query key.
const TAGS_QUERY = `
query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    media(id_in: $ids, type: ANIME) {
      idMal
      id
      bannerImage
      tags {
        name
        rank
        category
      }
      ${STAFF_PAGE_KEYS.map((_, i) => staffPageField(i + 1)).join('\n      ')}
      relations {
        edges {
          relationType
          node { id idMal type }
        }
      }
    }
  }
}`;

interface RawStaffEdge {
  role?: string;
  node?: { id?: number; name?: { full?: string } };
}
interface RawStaffConnection {
  edges?: RawStaffEdge[];
}
interface RawRelationEdge {
  relationType?: string;
  node?: { id?: number | null; idMal?: number | null; type?: string };
}
interface RawMedia {
  /**
   * AniList's declared MAL crosswalk, `null` for an AniList-only title. Read as
   * data on the way OUT, never used as a query key on the way in (E8).
   */
  idMal?: number | null;
  id: number;
  bannerImage?: string | null;
  tags: AniListTagEntry[];
  /** The aliased staff pages the query selects — see `STAFF_PAGE_KEYS`. */
  staffPage1?: RawStaffConnection;
  staffPage2?: RawStaffConnection;
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

/**
 * Flatten AniList staff edges to our lean {id,name,role} records, concatenating
 * the aliased pages in order so relevance ranking survives the merge.
 *
 * NOT de-duplicated by staff id on purpose: one person legitimately holds
 * several credits on a title (Tetsuya Yanagisawa is both Episode Director and
 * Storyboard on AniList 8407), and the role is half the record. The stats page
 * and the reco profile both count DISTINCT anime per person, so a repeated id
 * costs nothing there.
 */
function parseStaff(media: RawMedia): AniListStaffEntry[] {
  return STAFF_PAGE_KEYS.flatMap(key => media[key]?.edges ?? [])
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

/** One enrichment batch, by AniList id. */
async function fetchTagsBatch(anilistIds: number[]): Promise<RawMedia[]> {
  const data = await anilistQuery<{ Page?: { media?: RawMedia[] } }>(TAGS_QUERY, { ids: anilistIds });
  return data?.Page?.media ?? [];
}

// Crowd recommendations query — kept SEPARATE from TAGS_QUERY (tags + staff
// already sit near AniList's query-complexity ceiling; stacking a
// recommendations connection on top risks blowing it).
//
// Seeded by `id_in` like every other AniList query here (E8), and each
// `mediaRecommendation` yields **both** ids (E11). Selecting only `idMal` — as
// this did — threw away AniList's own identifier for a title AniList had just
// handed us, with two costs: recs AniList cannot map to a MAL id were dropped
// outright (precisely the AniList-only titles a keyless install exists to
// surface), and hydrating the survivors had to ask AniList *back* by MAL id,
// which was the only reason a `Media(idMal:)` bridge existed on that path.
const RECS_PER_ANIME = 15;
const RECS_QUERY = `
query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    media(id_in: $ids, type: ANIME) {
      id
      recommendations(sort: RATING_DESC, perPage: ${RECS_PER_ANIME}) {
        edges {
          node {
            rating
            mediaRecommendation { id idMal }
          }
        }
      }
    }
  }
}`;

interface RawRecEdge {
  node?: { rating?: number; mediaRecommendation?: { id?: number | null; idMal?: number | null } };
}
interface RawRecMedia {
  id: number;
  recommendations?: { edges?: RawRecEdge[] };
}

/**
 * One AniList crowd recommendation, carrying both of the recommended title's
 * ids. `anilistId` is always present (the edge came from AniList); `malId` is
 * AniList's declared crosswalk and may be absent — which is data, not a defect,
 * and no longer a reason to discard the edge.
 */
export interface AniListRecEdge {
  anilistId: number;
  malId?: number;
  /** AniList net recommendation rating (crowd backers) — always > 0 here. */
  rating: number;
}

async function fetchRecsBatch(anilistIds: number[]): Promise<RawRecMedia[]> {
  const data = await anilistQuery<{ Page?: { media?: RawRecMedia[] } }>(RECS_QUERY, { ids: anilistIds });
  return data?.Page?.media ?? [];
}

/**
 * Fetch AniList crowd recommendations for the given seed **AniList ids**,
 * batched by 50 (throttled by `client.ts` like every other AniList call).
 * Returns a map of seed AniList id -> recommended edges; only a non-positive net
 * rating drops an edge now. AniList silently skips ids it doesn't know, so the
 * map only contains seeds it recognized.
 */
export async function fetchAnilistRecommendations(
  seedAnilistIds: number[],
  onBatch?: (done: number, total: number) => void
): Promise<Map<number, AniListRecEdge[]>> {
  const ids = seedAnilistIds.filter(id => Number.isInteger(id));
  const batches = chunk(ids, BATCH_SIZE);
  const out = new Map<number, AniListRecEdge[]>();
  let processed = 0;

  for (const batch of batches) {
    try {
      const media = await fetchRecsBatch(batch);
      for (const m of media) {
        if (!m.id) continue;
        const edges: AniListRecEdge[] = (m.recommendations?.edges ?? [])
          .map(e => ({
            anilistId: e.node?.mediaRecommendation?.id ?? 0,
            malId: e.node?.mediaRecommendation?.idMal ?? undefined,
            rating: e.node?.rating ?? 0,
          }))
          .filter(e => e.anilistId > 0 && e.rating > 0);
        if (edges.length > 0) out.set(m.id, edges);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      appendLog('anilist-meta-sync', 'error', `AniList recos batch failed (anilist ids ${batch[0]}-${batch[batch.length - 1]}), continuing: ${message}`);
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
 * AniList ids of the titles that still need enrichment.
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
 * **No AniList id in the crosswalk ⇒ AniList does not enrich this title** (E8).
 * This used to route by MAL id first, which cost nothing but requests: a title
 * lacking an AniList id is precisely one AniList never returned, so the MAL-keyed
 * query was guaranteed to miss — and because a miss stores nothing, the same
 * ~6,000 titles re-queued on every single run and never converged. Dropping the
 * branch removes the loop at its source rather than needing a "looked, found
 * nothing" sentinel; absence from the crosswalk already carries that meaning.
 *
 * Coverage for those titles is the season crawl's job (`syncAnilistDiscovery` in
 * cron-sync, and `performAnilistBulkCatalogCrawl` for depth) — AniList-native
 * browsing returns `id` AND `idMal`, so one AniList-native call is what puts a
 * title's AniList id in the crosswalk in the first place.
 */
function selectMetaTargets(): number[] {
  const meta = getAllAnilistMeta();
  const anilistIds: number[] = [];

  for (const [canonicalId, crosswalk] of Object.entries(getRegistry())) {
    const e = meta[canonicalId];
    const needed = !e || e.staff === undefined || e.banner_image === undefined || e.relations === undefined;
    if (!needed) continue;
    const anilistId = toNum(crosswalk.anilist);
    if (anilistId !== undefined) anilistIds.push(anilistId);
  }

  return anilistIds;
}

/**
 * Force-refresh AniList tags + staff + banner + relations for specific **AniList
 * ids**, bypassing the "missing only" filter that `performAnilistMetaSync` uses.
 * Powers the per-anime refresh on the detail page. One batch, no throttle loop
 * (the caller passes few ids). Returns how many ids AniList actually had — it
 * silently skips ones it doesn't know.
 *
 * Took a `by: MetaIdSpace` until E8; it lost the parameter together with
 * `selectMetaTargets`' MAL branch, since a caller holding only a MAL id has
 * nothing for AniList to answer anyway.
 */
export async function refreshAnilistMetaForIds(
  anilistIds: number[]
): Promise<{ ok: boolean; tagged: number; error?: string }> {
  const batch = anilistIds.filter(id => Number.isInteger(id)).slice(0, BATCH_SIZE);
  if (batch.length === 0) return { ok: true, tagged: 0 };
  try {
    const media = await fetchTagsBatch(batch);
    const now = new Date().toISOString();
    // Keyed on `m.id` (AniList's own, always present) rather than `m.idMal` —
    // filtering on the MAL id here would discard exactly the AniList-only
    // titles this path exists for.
    const entries: AniListMetaEntry[] = media.filter(m => m.id).map(m => toEntry(m, now));
    if (entries.length > 0) upsertAnilistMeta(entries);
    return { ok: true, tagged: entries.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    appendLog('anilist-meta-sync', 'error', `AniList refresh failed for anilist ids ${batch.join(',')}: ${message}`);
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
    const anilistIds = selectMetaTargets();
    const totalMissing = anilistIds.length;

    if (totalMissing === 0) {
      appendLog('anilist-meta-sync', 'success', 'AniList sync: nothing to do, all anime already have tags + staff');
      return { ok: true, alreadyRunning: false, totalMissing: 0, processed: 0, tagged: 0, failed: 0 };
    }

    appendLog(
      'anilist-meta-sync',
      'info',
      `AniList metadata sync started: ${totalMissing} anime to fetch by AniList id`,
      { byAnilistId: totalMissing }
    );

    // One id space since E8. Pacing is `client.ts`'s job, shared with every
    // other AniList caller — no `setTimeout` of our own.
    const batches = chunk(anilistIds, BATCH_SIZE);
    let processed = 0;
    let tagged = 0;
    let failed = 0;

    for (const [batchIndex, batch] of batches.entries()) {
      try {
        const media = await fetchTagsBatch(batch);
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
        console.error(`AniList tags batch ${batchIndex + 1}/${batches.length} error (anilist ids ${batch[0]}-${batch[batch.length - 1]}):`, error);
        appendLog(
          'anilist-meta-sync',
          'error',
          `AniList tags batch ${batchIndex + 1}/${batches.length} failed, continuing: ${errorMessage}`,
          {
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            batchSize: batch.length,
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
//
// `studios` MUST use the edge form: AniList's studios connection holds animation
// studios AND producers together, and `isMain` is the only thing separating them
// (`cast.ts` already relies on exactly this). `nodes` discards the edge and with
// it the flag, so it imports producers AS studios — measured at 2.68 studios per
// title against MAL's 1.10 before this was fixed. See
// docs/DECISIONS.md, "Catalog precedence".
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
      studios { edges { isMain node { id name } } }`;

/**
 * Schema version of the `catalog` block `toCatalogEntry` produces.
 *
 * This is the **re-sweep signal**, and it exists because the ordinary backfill
 * signal cannot express what happens when the query SHAPE changes. `catalog ===
 * undefined` means "never fetched"; it has nothing to say about 19k entries that
 * were fetched correctly under a wrong query. Bumping this re-queues every entry
 * written by an older shape, and — unlike a force flag — the run stays
 * **resumable**: each batch persists at the new version and stops re-queueing, so
 * an interrupted 15-20 min sweep resumes instead of restarting from zero.
 *
 * Bump when the produced block changes in a way that makes stored data wrong.
 *
 * - **1** — implicit/absent. `studios` came from `studios { nodes }`, so producers
 *   were imported as animation studios (2.68 studios/title vs MAL's 1.10).
 * - **2** — `studios { edges { isMain node } }`, mains only; empty `genres`/
 *   `studios` stored as `undefined` rather than `[]`.
 */
export const CATALOG_SCHEMA_VERSION = 2;

const CATALOG_QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: ${BATCH_SIZE}) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC, type: ANIME) {${CATALOG_FIELDS}
    }
  }
}`;

/**
 * Same fields, filtered by a **start-date range** instead of a season — the
 * historical crawl's query.
 *
 * **AniList leaves `season` null on a large share of older titles** (OVAs,
 * movies, specials and plenty of old TV), and `media(season:)` cannot match a
 * null. Measured live 2026-07-25, titles AniList holds for a year vs the ones a
 * season crawl can see:
 *
 * | Year | by start date | no `season` set |
 * |---|---|---|
 * | 2017 | 848 | 302 (36%) |
 * | 2010 | 568 | 139 (24%) |
 * | 1998 | 234 | 53 (23%) |
 * | 1985 | 143 | 42 (29%) |
 * | 1970 | 51 | 23 (45%) |
 *
 * So the season crawl is not merely *shallow* on the back catalog, it is
 * **structurally blind** to a quarter of it — which is why the historical crawl
 * is a different query rather than `performAnilistBulkCatalogCrawl` with a
 * bigger `yearsBack`.
 *
 * ⚠️ **The lower bound must be `YYYY0000 - 1`, exclusive.** `startDate_greater`
 * is strict, and a title whose month/day AniList doesn't know is stored as the
 * fuzzy `YYYY0000` — so a bound of `19980000` drops exactly those. That cost 28
 * of 1998's 234 titles when this was first probed with the obvious bound.
 */
const CATALOG_BY_YEAR_QUERY = `
query ($from: FuzzyDateInt, $to: FuzzyDateInt, $page: Int) {
  Page(page: $page, perPage: ${BATCH_SIZE}) {
    pageInfo { hasNextPage }
    media(startDate_greater: $from, startDate_lesser: $to, sort: POPULARITY_DESC, type: ANIME) {${CATALOG_FIELDS}
    }
  }
}`;

// The by-id catalog query — same fields, filtered by AniList's OWN id. This is
// the id-space policy in code: a title whose AniList id we hold is enriched
// THROUGH that id, never bridged back through MAL's. It had a `CATALOG_BY_MAL_QUERY`
// twin for the keyless reco-hydration path; E11 removed the need by keeping
// AniList's id on the recommendation edges that path consumes, so there is one
// query and one id space left here.
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
  studios?: {
    edges?: ({ isMain?: boolean | null; node?: { id?: number | null; name?: string | null } | null } | null)[] | null;
  } | null;
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
 * Shared by the season crawler, the catalog sweep and `fetchAnilistCatalog` —
 * the keyless hydration path for reco candidates. All need AniList's catalog
 * view of a title in exactly the same shape; only the *query* that finds the
 * media differs (by season vs. by id).
 */
function toCatalogEntry(m: RawCatalogMedia): AniListCatalogEntry | null {
  const title = m.title?.english || m.title?.romaji;
  if (!title) return null;
  const mean = typeof m.averageScore === 'number' ? m.averageScore / 10 : undefined;
  // AniList genres are names only → synthetic id 0 (consumers key on name).
  const genres = (m.genres ?? [])
    .filter((g): g is string => !!g)
    .map(name => ({ id: 0, name }));
  // Animation studios only — `isMain: false` is a producer and must not land in
  // `catalog.studios` (hazard 2). AniList studios carry AniList-namespace ids
  // (see AniListMetaEntry.catalog caveat).
  const studios = (m.studios?.edges ?? [])
    .filter(e => !!e && e.isMain === true && !!e.node?.name)
    .map(e => ({ id: e!.node!.id ?? 0, name: e!.node!.name as string }));
  const cover = m.coverImage?.medium || m.coverImage?.large
    ? { medium: m.coverImage?.medium ?? m.coverImage?.large ?? '', large: m.coverImage?.large ?? m.coverImage?.medium ?? '' }
    : undefined;
  const catalog: NonNullable<AniListMetaEntry['catalog']> = {
    v: CATALOG_SCHEMA_VERSION,
    title,
    titleRomaji: m.title?.romaji ?? undefined,
    titleEnglish: m.title?.english ?? undefined,
    mean,
    // `undefined`, never `[]`, when AniList has none. `mergeWithProvenance` takes
    // the first source whose value is `!== undefined`, so an empty array is a
    // WINNING value — under a future `studios: ['anilist','mal']` flip an empty
    // AniList list would silently beat MAL's real one. Same trap the isMain fix
    // above exists to avoid, arriving through a different door.
    genres: genres.length > 0 ? genres : undefined,
    studios: studios.length > 0 ? studios : undefined,
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
 * Fetch AniList's catalog view of specific **AniList ids** and persist it — the
 * **keyless hydration path** for recommendation candidates.
 *
 * `performRecommendationsRefresh` hydrates candidate titles missing from the
 * local catalog so the feed has something to rank. This is the keyless path for
 * that: with no MAL account the candidates come from `anilistCrowd`, i.e.
 * AniList's own recommendation edges, which since E11 carry AniList's id — so
 * the title is fetched with the provider's own key and no bridge is involved.
 * Without this path a user with no MAL account accumulates AniList crowd edges
 * and renders none of them.
 *
 * Was `fetchAnilistCatalogByMalIds`, taking MAL ids through an `idMal_in`
 * filter. The rename is the point, not cosmetics: the id space changed.
 *
 * Persists through `upsertAnilistCatalogFields`, so a hydrated title lands as a
 * `catalog` block on the AniList meta slice and renders through the normal
 * provenance hydration — exactly like a title the season crawler found. Titles
 * AniList doesn't know are silently skipped. Batched by 50, on the shared
 * `client.ts` throttle like every other sweep here.
 */
export async function fetchAnilistCatalog(
  anilistIds: number[],
  onBatch?: (done: number, total: number) => void
): Promise<{ requested: number; hydrated: number; failed: number }> {
  const ids = anilistIds.filter(id => Number.isInteger(id));
  const batches = chunk(ids, BATCH_SIZE);
  let processed = 0;
  let hydrated = 0;
  let failed = 0;

  for (const batch of batches) {
    try {
      const data = await anilistQuery<{ Page?: { media?: RawCatalogMedia[] } }>(
        CATALOG_BY_ANILIST_QUERY,
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
// AniList HISTORICAL crawl — the back catalog, by year, checkpointed
// ============================================================================
//
// The third crawl: AniList's own back catalog, year by year. Mirrors MAL's
// `performHistoricalCrawl` — a checkpoint file, a batch per invocation,
// resumable, newest-first.
//
// ⚠️ **This does NOT close the registry's AniList-id gap, and nothing can.**
// It was built to, on the theory that the ~24% of titles holding no AniList id
// were out of the season crawl's reach. A full live run (2017→1960, 58 years,
// 14,204 titles) moved that gap by **exactly zero**: every era bucket came back
// unchanged. Sampling 30 of the gap titles across both eras and asking AniList
// for each by MAL id returned **0 hits** — they are recaps, specials, pilot
// films, music videos, CMs, PVs and a long tail of Chinese/Korean web animation
// that MAL catalogues as standalone entries and **AniList simply does not
// carry**. The gap is a catalog-scope difference between two sites, not a
// coverage bug, so do not "fix" it by widening a window or a page cap again.
//
// What the run DID buy, and why this stays: **1,693 titles the store did not
// have at all** — 572 with no MAL id anywhere (AniList-only, exactly the
// population the provider-free direction exists to reach) and 1,121 whose MAL
// id MAL's own seasonal crawl never landed. That is the honest justification:
// this crawls AniList's catalog for what AniList has, not for what MAL has.
//
// **Two things make it a different query, not a bigger `yearsBack`:**
//
// 1. It walks **years by start date**, because `season` is null on 23-45% of
//    pre-2018 titles and `media(season:)` cannot match a null (table on
//    `CATALOG_BY_YEAR_QUERY`). That is what makes the run *complete* over what
//    AniList holds — the finding above (no reachable gap left) is only
//    trustworthy because this query has no season-shaped blind spot.
// 2. It does **not cap pages per year**. The bulk crawl's `maxPagesPerSeason`
//    exists to make first-run onboarding fast — it takes the popularity head and
//    moves on. This one is a coverage tool, so it pages a year to exhaustion
//    (`hasNextPage`), which for the back catalog is 2-17 pages.
//
// Cost, sized live: the 5 sampled years above are 1,844 titles in 39 pages, and
// the whole 1960→cutoff window extrapolates to ~300-350 pages ≈ 11-12 min on the
// shared 2.1s throttle. Cheap enough that the batching exists to be polite to
// cron ticks, not because the full run is expensive.

const HISTORICAL_CRAWL_FILE = dataFile('sync/anilist_years.json');
const HISTORICAL_CRAWL_OLDEST_YEAR = 1960;
// A runaway guard, not a coverage knob — the point of this crawl is that it
// pages a year to exhaustion. The busiest sampled year (2017) took 17 pages, so
// 40 leaves ample headroom while still bounding a year that never reports
// `hasNextPage: false`.
const HISTORICAL_MAX_PAGES_PER_YEAR = 40;

interface AnilistHistoricalCheckpoint {
  syncedYears: number[];
}

function getHistoricalCheckpoint(): AnilistHistoricalCheckpoint {
  return readJsonFile<AnilistHistoricalCheckpoint>(HISTORICAL_CRAWL_FILE, { syncedYears: [] });
}

function markYearSynced(year: number): void {
  const set = new Set(getHistoricalCheckpoint().syncedYears);
  set.add(year);
  writeJsonFile(HISTORICAL_CRAWL_FILE, { syncedYears: Array.from(set).sort((a, b) => b - a) });
}

/**
 * The newest year the historical crawl owns: one year older than the bulk
 * crawl's window, so the two tile rather than overlap.
 *
 * Pass a `from` to widen it. `from = current year` makes this cover the whole
 * catalog — which is how the 2018+ half of the id gap gets closed, since that
 * one is caused by `maxPagesPerSeason`, not by the year window.
 */
function historicalNewestYear(): number {
  return getSeasonInfos().current.year - (BULK_CRAWL_YEARS_BACK + 1);
}

export interface AnilistHistoricalCrawlStats {
  syncedYears: number;
  remainingYears: number;
  totalYears: number;
  oldestSyncedYear: number | null;
  nextYear: number | null;
}

export function getAnilistHistoricalCrawlStats(from?: number): AnilistHistoricalCrawlStats {
  const newest = from ?? historicalNewestYear();
  const synced = new Set(getHistoricalCheckpoint().syncedYears);
  const all: number[] = [];
  for (let y = newest; y >= HISTORICAL_CRAWL_OLDEST_YEAR; y--) all.push(y);
  const done = all.filter(y => synced.has(y));
  const remaining = all.filter(y => !synced.has(y));
  return {
    syncedYears: done.length,
    remainingYears: remaining.length,
    totalYears: all.length,
    oldestSyncedYear: done.length > 0 ? Math.min(...done) : null,
    nextYear: remaining.length > 0 ? remaining[0] : null,
  };
}

export interface AnilistHistoricalCrawlResult {
  ok: boolean;
  alreadyRunning: boolean;
  yearsCrawled: number;
  yearsFailed: number;
  titles: number;
  withMal: number;
  anilistOnly: number;
  minted: number;
  stats: AnilistHistoricalCrawlStats;
  error?: string;
}

/** Fetch + map one year's pages to exhaustion. No persistence, no lock. */
async function crawlCatalogYear(year: number): Promise<SeasonCrawlOutcome> {
  const entries: AniListCatalogEntry[] = [];
  const seen = new Set<number>();
  let withMal = 0;
  let anilistOnly = 0;
  let pagesFetched = 0;

  // `- 1` because startDate_greater is strict and fuzzy dates are `YYYY0000`.
  const from = year * 10000 - 1;
  const to = (year + 1) * 10000;

  for (let page = 1; page <= HISTORICAL_MAX_PAGES_PER_YEAR; page++) {
    const data = await anilistQuery<{ Page?: RawCatalogPage }>(CATALOG_BY_YEAR_QUERY, { from, to, page });
    const result = data?.Page ?? { media: [] };
    pagesFetched++;

    for (const m of result.media ?? []) {
      const entry = toCatalogEntry(m);
      // Dedupe within the year: POPULARITY_DESC is not a stable total order, so
      // a title can repeat across page boundaries.
      if (!entry || seen.has(entry.anilist_id)) continue;
      seen.add(entry.anilist_id);
      entries.push(entry);
      if (entry.mal_id !== undefined) withMal++; else anilistOnly++;
    }

    if (!result.pageInfo?.hasNextPage) break;
  }

  return { entries, pagesFetched, withMal, anilistOnly };
}

/**
 * Crawl the back catalog year by year, newest first, `maxYears` per invocation
 * (default: every remaining year).
 *
 * **Persists and checkpoints after EVERY year**, so an interrupted run keeps
 * what it fetched and the next one resumes at the next unsynced year — the same
 * property that makes the cast sweep safe to just run. A year that throws is
 * non-fatal and is NOT checkpointed, so it is retried next time.
 *
 * The checkpoint is permanent: a year is never re-crawled once done. AniList
 * does keep adding old titles, so re-running the whole window means deleting
 * `sync/anilist_years.json` — a deliberate manual act, like MAL's equivalent.
 */
export async function performAnilistHistoricalCrawl(
  maxYears?: number,
  from?: number
): Promise<AnilistHistoricalCrawlResult> {
  if (isAnilistCatalogCrawlRunning) {
    appendLog('anilist-catalog-crawl', 'info', 'AniList historical crawl skipped: a catalog crawl is already running');
    return { ok: false, alreadyRunning: true, yearsCrawled: 0, yearsFailed: 0, titles: 0, withMal: 0, anilistOnly: 0, minted: 0, stats: getAnilistHistoricalCrawlStats(from) };
  }

  const newest = from ?? historicalNewestYear();
  const synced = new Set(getHistoricalCheckpoint().syncedYears);
  const queue: number[] = [];
  for (let y = newest; y >= HISTORICAL_CRAWL_OLDEST_YEAR; y--) {
    if (!synced.has(y)) queue.push(y);
    if (maxYears !== undefined && queue.length >= maxYears) break;
  }

  if (queue.length === 0) {
    appendLog('anilist-catalog-crawl', 'success', 'AniList historical crawl already complete: no remaining years');
    return { ok: true, alreadyRunning: false, yearsCrawled: 0, yearsFailed: 0, titles: 0, withMal: 0, anilistOnly: 0, minted: 0, stats: getAnilistHistoricalCrawlStats(from) };
  }

  isAnilistCatalogCrawlRunning = true;
  let yearsCrawled = 0;
  let yearsFailed = 0;
  let titles = 0;
  let withMal = 0;
  let anilistOnly = 0;
  let minted = 0;
  try {
    appendLog(
      'anilist-catalog-crawl',
      'info',
      `AniList historical crawl started: ${queue.length} years (${queue[queue.length - 1]} → ${queue[0]})`,
      { totalYears: queue.length }
    );

    for (let i = 0; i < queue.length; i++) {
      const year = queue[i];
      try {
        const result = await crawlCatalogYear(year);
        const counts = result.entries.length > 0
          ? resolveCanonicalIds(result.entries.map(e => ({ mal: e.mal_id, anilist: e.anilist_id })))
          : { minted: 0, resolved: 0 };
        if (result.entries.length > 0) upsertAnilistCatalogFields(result.entries);
        markYearSynced(year);

        yearsCrawled++;
        titles += result.entries.length;
        withMal += result.withMal;
        anilistOnly += result.anilistOnly;
        minted += counts.minted;
        appendLog(
          'anilist-catalog-crawl',
          'info',
          `AniList historical: ${year} — ${result.entries.length} titles in ${result.pagesFetched} pages (${result.withMal} with a MAL id)`,
          { yearIndex: i + 1, totalYears: queue.length, year, titles: result.entries.length }
        );
      } catch (error) {
        // Non-fatal and NOT checkpointed — a transient AniList hiccup must not
        // burn the year. Logged at info level; an error-level entry is the
        // onboarding panel's fatal signal and this is not that.
        yearsFailed++;
        const message = error instanceof Error ? error.message : 'Unknown error';
        appendLog(
          'anilist-catalog-crawl',
          'info',
          `AniList historical: ${year} failed, continuing`,
          { yearIndex: i + 1, totalYears: queue.length, year, error: message }
        );
      }
    }

    const stats = getAnilistHistoricalCrawlStats(from);
    appendLog(
      'anilist-catalog-crawl',
      'success',
      `AniList historical crawl complete: ${yearsCrawled}/${queue.length} years, ${titles} titles (${minted} canonical ids minted)${yearsFailed > 0 ? `, ${yearsFailed} years failed` : ''} — ${stats.remainingYears} years remaining`,
      { yearsCrawled, yearsFailed, titles, withMal, anilistOnly, minted, remainingYears: stats.remainingYears }
    );
    return { ok: yearsCrawled > 0, alreadyRunning: false, yearsCrawled, yearsFailed, titles, withMal, anilistOnly, minted, stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('AniList historical crawl error:', error);
    appendLog('anilist-catalog-crawl', 'error', 'AniList historical crawl failed', { error: message });
    return { ok: false, alreadyRunning: false, yearsCrawled, yearsFailed, titles, withMal, anilistOnly, minted, stats: getAnilistHistoricalCrawlStats(from), error: message };
  } finally {
    isAnilistCatalogCrawlRunning = false;
  }
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
// docs/DECISIONS.md).
//
// **Queries AniList by ITS OWN id**, read from the crosswalk — the id-space
// policy in code. A title with no AniList id is simply not swept; coverage there
// is the season crawl's job, never a MAL-id bridge's.

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
 * AniList ids of titles whose `catalog` block is missing OR was written by an
 * older schema version. The scan source is the **registry**, not the MAL slice,
 * for the same reason `selectMetaTargets` uses it — a title MAL doesn't know can
 * still have an AniList id worth sweeping.
 *
 * Two re-queue signals, and they mean different things:
 * - `catalog === undefined` — never fetched (no entry at all counts too).
 * - `catalog.v !== CATALOG_SCHEMA_VERSION` — fetched, but under a query shape
 *   that produced wrong data. This is what makes a re-sweep possible at all;
 *   see `CATALOG_SCHEMA_VERSION` for why a force flag was the wrong tool.
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
    if (e && e.catalog !== undefined && e.catalog.v === CATALOG_SCHEMA_VERSION) continue; // already swept, current shape
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
