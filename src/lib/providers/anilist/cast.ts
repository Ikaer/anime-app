/**
 * AniList cast fetch — characters + their Japanese voice actors (seiyuu), for
 * the detail page's Cast section. Public GraphQL API, no auth. Read-only.
 *
 * Kept OUT of `anilistSync.ts` on purpose. That module's syncs are catalog-wide
 * sweeps whose output feeds the hydration path and the reco sources; this is a
 * lazy, one-title-at-a-time fill of a display-only slice
 * (`catalog/anilist_cast.json` — see `AniListCastEntry` for why it's its own
 * file). A title is fetched the first time someone opens its detail page, and
 * then never again unless explicitly refreshed.
 */
import { getAnilistCast, upsertAnilistCast } from '@/lib/store';
import { appendLog } from '@/lib/config/connectionLog';
import { anilistFetch, graphqlErrorMessage, httpErrorMessage } from '@/lib/providers/anilist/client';
import { AniListCastEntry, AniListCastStudioEntry, AniListCharacterEntry, AniListVoiceActorEntry, AnimeRecord } from '@/models/anime';

// Characters to keep per anime. Sorted [ROLE, RELEVANCE], so this is "every
// MAIN plus the most relevant supporting cast" — a long tail of BACKGROUND
// one-liners adds payload without adding meaning (Attack on Titan alone
// reports 500 character edges).
const CHARACTERS_PER_ANIME = 25;

// A single-title query, so unlike the batched syncs in anilistSync.ts there is
// no query-complexity pressure here and `Media(...)` may be used directly.
// `language: JAPANESE` is what makes these seiyuu rather than dub actors.
const CAST_QUERY = `
query ($malId: Int, $anilistId: Int) {
  Media(idMal: $malId, id: $anilistId, type: ANIME) {
    id
    idMal
    characters(sort: [ROLE, RELEVANCE], perPage: ${CHARACTERS_PER_ANIME}) {
      edges {
        role
        node {
          id
          name { full native }
          image { large medium }
        }
        voiceActors(language: JAPANESE) {
          id
          name { full native }
          image { large medium }
        }
      }
    }
    studios {
      edges {
        isMain
        node { id name }
      }
    }
  }
}`;

interface RawName { full?: string | null; native?: string | null }
interface RawImage { large?: string | null; medium?: string | null }
interface RawPerson {
  id?: number;
  name?: RawName | null;
  image?: RawImage | null;
}
interface RawCharacterEdge {
  role?: string | null;
  node?: RawPerson | null;
  voiceActors?: RawPerson[] | null;
}
interface RawStudioEdge {
  isMain?: boolean | null;
  node?: { id?: number | null; name?: string | null } | null;
}
interface RawCastMedia {
  id?: number;
  idMal?: number | null;
  characters?: { edges?: RawCharacterEdge[] | null } | null;
  studios?: { edges?: RawStudioEdge[] | null } | null;
}

/**
 * AniList serves a shared grey silhouette for people with no portrait. It's a
 * real URL, so it can't be filtered by absence — matching the well-known
 * `default.jpg` basename lets the UI fall back to initials instead of showing
 * a wall of identical placeholders.
 */
function cleanImage(image?: RawImage | null): string | undefined {
  const url = image?.large || image?.medium || '';
  if (!url || /\/default\.[a-z]+$/i.test(url)) return undefined;
  return url;
}

function toVoiceActor(raw: RawPerson): AniListVoiceActorEntry | null {
  if (typeof raw.id !== 'number') return null;
  return {
    id: raw.id,
    name: raw.name?.full ?? '',
    nameNative: raw.name?.native ?? undefined,
    image: cleanImage(raw.image),
  };
}

function toCharacter(edge: RawCharacterEdge): AniListCharacterEntry | null {
  const node = edge.node;
  if (!node || typeof node.id !== 'number') return null;
  return {
    id: node.id,
    name: node.name?.full ?? '',
    nameNative: node.name?.native ?? undefined,
    image: cleanImage(node.image),
    role: edge.role ?? '',
    voiceActors: (edge.voiceActors ?? [])
      .map(toVoiceActor)
      .filter((va): va is AniListVoiceActorEntry => va !== null),
  };
}

function toStudio(edge: RawStudioEdge): AniListCastStudioEntry | null {
  const node = edge.node;
  if (!node || typeof node.id !== 'number' || !node.name) return null;
  return { id: node.id, name: node.name, isMain: edge.isMain === true };
}

/** Thrown for a genuine failure. A "title not on AniList" miss is NOT one — see below. */
class AniListCastError extends Error {}

/**
 * Query AniList for one title. Returns `null` when AniList simply doesn't have
 * the title, which is a legitimate answer rather than an error: AniList answers
 * an unknown id with a GraphQL `404 Not Found` and `data.Media: null`. Treating
 * that as a failure would leave the title permanently unfetched and re-query it
 * on every single page view; the caller instead persists an empty cast.
 */
async function fetchCast(ids: { malId?: number; anilistId?: number }): Promise<RawCastMedia | null> {
  // Only the id we actually have is sent. Passing the other one as an explicit
  // `null` is NOT equivalent to omitting it: AniList applies a supplied-but-null
  // argument as a real filter (`id = null`), which matches nothing and answers
  // 404 — and since `fetchCast` reads a 404 as "AniList has no cast", that
  // silently persisted an empty cast for EVERY title. Verified live 2026-07-19:
  // `{malId: 16498, anilistId: null}` → 404, `{malId: 16498}` → 200.
  const variables: Record<string, number> = {};
  if (ids.malId !== undefined) variables.malId = ids.malId;
  if (ids.anilistId !== undefined) variables.anilistId = ids.anilistId;

  // Deliberately `anilistFetch` rather than the strict `anilistQuery`: a 404 is
  // a legitimate answer here, so this caller has to see the status itself.
  const res = await anilistFetch<{ Media: RawCastMedia | null }>(CAST_QUERY, variables);

  if (!res.ok && res.status !== 404) {
    throw new AniListCastError(httpErrorMessage(res));
  }

  const media = res.body.data?.Media ?? null;
  const errors = res.body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    // A 404 alongside a null Media is the "AniList doesn't have it" answer.
    if (errors.some(e => e.status === 404) && !media) return null;
    throw new AniListCastError(graphqlErrorMessage(errors));
  }
  return media;
}

export interface AniListCastResult {
  ok: boolean;
  /** The stored entry — present whenever `ok`, even if its cast is empty. */
  entry?: AniListCastEntry;
  /** True when the entry was served from the slice rather than fetched. */
  cached: boolean;
  error?: string;
}

/** True when this title still needs a fetch — the sweep's queue predicate. */
function needsCastFetch(canonicalId: string): boolean {
  const cached = getAnilistCast(canonicalId);
  return !cached || cached.studios === undefined;
}

/**
 * Get one title's cast, fetching + persisting it if it isn't cached yet.
 *
 * `force` bypasses the cache (the detail page's refresh button). Without it,
 * ANY existing entry short-circuits — including one with an empty `characters`
 * array, which records that AniList was asked and had nothing. That's the whole
 * point of storing empties: an absent entry means "never asked", so a title
 * AniList lacks is fetched exactly once, not on every page view.
 */
export async function getOrFetchAnilistCast(
  canonicalId: string,
  ids: { malId?: number; anilistId?: number },
  force = false
): Promise<AniListCastResult> {
  if (!force) {
    const cached = getAnilistCast(canonicalId);
    // `studios === undefined` means the entry predates that field, so it is
    // refetched once to backfill producers — same backfill discipline as
    // `staff`/`banner_image` in anilistSync.ts. An entry that HAS the field
    // short-circuits even when both it and `characters` are empty, which is the
    // whole point of persisting empties (see this function's doc comment).
    if (cached && cached.studios !== undefined) return { ok: true, entry: cached, cached: true };
  }

  if (ids.malId === undefined && ids.anilistId === undefined) {
    return { ok: false, cached: false, error: 'No MAL or AniList id known for this title' };
  }

  try {
    const media = await fetchCast(ids);
    const entry: AniListCastEntry = {
      mal_id: media?.idMal ?? ids.malId,
      anilist_id: media?.id ?? ids.anilistId,
      characters: (media?.characters?.edges ?? [])
        .map(toCharacter)
        .filter((c): c is AniListCharacterEntry => c !== null),
      // Always an array (never left undefined) so this entry is not re-queued
      // by the backfill signal above on the next pass.
      studios: (media?.studios?.edges ?? [])
        .map(toStudio)
        .filter((s): s is AniListCastStudioEntry => s !== null),
      fetched_at: new Date().toISOString(),
    };
    // Persisted even when empty — see the doc comment above.
    upsertAnilistCast(canonicalId, entry);
    return { ok: true, entry, cached: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    appendLog('anilist-cast', 'error', `AniList cast fetch failed for ${canonicalId}: ${message}`, {
      canonicalId,
      ...ids,
      error: message,
    });
    return { ok: false, cached: false, error: message };
  }
}

// ============================================================================
// Catalog-wide sweep — the bulk fill behind the stats page's seiyuu/producers
// dimensions.
// ============================================================================
//
// Scoped to the STATUSED list (~500 titles), never the ~25k crawled catalog:
// those are the only titles the stats page reports on, and a catalog-wide sweep
// at AniList's throttle would run for half a day to fill data nothing reads.
//
// Deliberately reuses the single-title path rather than batching through
// `Page.media`: nested `characters { voiceActors }` across 50 media is exactly
// the query-complexity gamble sync.ts keeps warning about, and the payoff is not
// needed — this is a ONE-TIME fill whose results persist, so ~500 × 2.1s is a
// cost paid once, not per page view. The pacing itself is not this loop's
// business: `client.ts` throttles every AniList request process-wide.

/** `SourceIds` values may arrive as strings (SIMKL mirrors some as such). */
function toNum(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * The id pair to query one record by. `sources.anilist.anilist_id` is preferred
 * over the crosswalk's copy for the same reason the single-title route prefers
 * it: it's AniList's own resolved id, whereas the crosswalk may carry SIMKL's
 * occasionally-stale mirror of it.
 */
function castIdsFor(anime: AnimeRecord): { malId?: number; anilistId?: number } {
  return {
    malId: toNum(anime.crosswalk.mal),
    anilistId: anime.sources.anilist?.anilist_id ?? toNum(anime.crosswalk.anilist),
  };
}

let isCastSweepRunning = false;

export interface AniListCastSweepResult {
  ok: boolean;
  alreadyRunning: boolean;
  /** Titles that needed a fetch when the sweep started. */
  queued: number;
  fetched: number;
  failed: number;
  error?: string;
}

/**
 * Fill the cast slice for every statused title that lacks one.
 *
 * Fire-and-forget (the API route doesn't await it) — progress surfaces through
 * `appendLog('anilist-cast-sweep', …)`, polled client-side, the same pattern as
 * the meta sync and catalog crawl. Individual failures are non-fatal and
 * counted; only an unexpected throw aborts the run.
 *
 * **Resumable by construction, which is what makes a ~20-minute unawaited loop
 * safe.** Each title is persisted as it lands and `needsCastFetch` re-queues
 * only what is still missing, so a run cut short — process restart, redeploy,
 * or (in `next dev`) a recompile abandoning the promise — loses nothing but the
 * title in flight. Pressing the button again picks up where it stopped;
 * verified live 2026-07-19 (interrupted at 69/665, restart queued 596).
 */
export async function performAnilistCastSweep(): Promise<AniListCastSweepResult> {
  if (isCastSweepRunning) {
    appendLog('anilist-cast-sweep', 'info', 'AniList cast sweep skipped: already running');
    return { ok: false, alreadyRunning: true, queued: 0, fetched: 0, failed: 0 };
  }

  isCastSweepRunning = true;
  try {
    // Imported lazily: this module is otherwise a leaf that the detail page's
    // single-title path uses, and store.ts is the heavy `fs`-bound join.
    const { getAnimeForDisplay } = await import('@/lib/store');
    const { getEffectiveStatus } = await import('@/lib/domain/animeUtils');

    const queue = getAnimeForDisplay()
      .filter(a => !!getEffectiveStatus(a))
      // Same id resolution the fetch itself will use, so a title whose only id
      // is a non-numeric string is dropped here rather than counted as a failure.
      .filter(a => {
        const ids = castIdsFor(a);
        return ids.malId !== undefined || ids.anilistId !== undefined;
      })
      .filter(a => needsCastFetch(a.id));

    appendLog('anilist-cast-sweep', 'info',
      `AniList cast sweep started: ${queue.length} statused titles to fill`,
      { queued: queue.length });

    if (queue.length === 0) {
      appendLog('anilist-cast-sweep', 'success', 'AniList cast sweep complete: nothing to fill', {
        queued: 0, fetched: 0, failed: 0,
      });
      return { ok: true, alreadyRunning: false, queued: 0, fetched: 0, failed: 0 };
    }

    let fetched = 0;
    let failed = 0;

    for (let i = 0; i < queue.length; i++) {
      const anime = queue[i];
      const result = await getOrFetchAnilistCast(anime.id, castIdsFor(anime));
      if (result.ok) fetched++;
      else failed++;

      // Every 25th title, so a ~500-title run leaves ~20 progress entries rather
      // than 500. `{index,total}` mirrors the bulk crawl's `{seasonIndex,
      // totalSeasons}`, which is what a client progress bar reads.
      if ((i + 1) % 25 === 0 || i === queue.length - 1) {
        appendLog('anilist-cast-sweep', 'info',
          `AniList cast sweep: ${i + 1}/${queue.length} titles processed`,
          { index: i + 1, total: queue.length, fetched, failed });
      }
    }

    appendLog('anilist-cast-sweep', 'success',
      `AniList cast sweep complete: ${fetched} filled, ${failed} failed`,
      { queued: queue.length, fetched, failed });

    return { ok: true, alreadyRunning: false, queued: queue.length, fetched, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('AniList cast sweep error:', error);
    appendLog('anilist-cast-sweep', 'error', 'AniList cast sweep failed', { error: message });
    return { ok: false, alreadyRunning: false, queued: 0, fetched: 0, failed: 0, error: message };
  } finally {
    isCastSweepRunning = false;
  }
}

/** Coverage + run state for the stats page's sweep button. */
export async function getAnilistCastSweepStats(): Promise<{
  statused: number;
  filled: number;
  missing: number;
  sweepRunning: boolean;
}> {
  const { getAnimeForDisplay } = await import('@/lib/store');
  const { getEffectiveStatus } = await import('@/lib/domain/animeUtils');

  const statusedTitles = getAnimeForDisplay().filter(a => !!getEffectiveStatus(a));
  const missing = statusedTitles.filter(a => needsCastFetch(a.id)).length;

  return {
    statused: statusedTitles.length,
    filled: statusedTitles.length - missing,
    missing,
    sweepRunning: isCastSweepRunning,
  };
}
