/**
 * AniList cast fetch — characters + their Japanese voice actors (seiyuu), for
 * the detail page's Cast section. Public GraphQL API, no auth. Read-only.
 *
 * Kept OUT of `anilistSync.ts` on purpose. That module's syncs are catalog-wide
 * sweeps whose output feeds the hydration path and the reco sources; this is a
 * lazy, one-title-at-a-time fill of a display-only slice
 * (`animes_anilist_cast.json` — see `AniListCastEntry` for why it's its own
 * file). A title is fetched the first time someone opens its detail page, and
 * then never again unless explicitly refreshed.
 */
import { getAnilistCast, upsertAnilistCast } from '@/lib/store';
import { appendLog } from '@/lib/connectionLog';
import { AniListCastEntry, AniListCharacterEntry, AniListVoiceActorEntry } from '@/models/anime';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

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
interface RawCastMedia {
  id?: number;
  idMal?: number | null;
  characters?: { edges?: RawCharacterEdge[] | null } | null;
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

/** Thrown for a genuine failure. A "title not on AniList" miss is NOT one — see below. */
class AniListCastError extends Error {}

/**
 * Query AniList for one title. Returns `null` when AniList simply doesn't have
 * the title, which is a legitimate answer rather than an error: AniList answers
 * an unknown id with a GraphQL `404 Not Found` and `data.Media: null`. Treating
 * that as a failure would leave the title permanently unfetched and re-query it
 * on every single page view; the caller instead persists an empty cast.
 */
async function fetchCast(
  ids: { malId?: number; anilistId?: number },
  retryOn429 = true
): Promise<RawCastMedia | null> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: CAST_QUERY,
      variables: { malId: ids.malId ?? null, anilistId: ids.anilistId ?? null },
    }),
  });

  if (res.status === 429) {
    if (!retryOn429) throw new AniListCastError('AniList rate limit exceeded (retry already attempted)');
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 60_000;
    await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfterMs) ? retryAfterMs : 60_000));
    return fetchCast(ids, false);
  }

  if (!res.ok && res.status !== 404) {
    const bodyText = await res.text().catch(() => '');
    throw new AniListCastError(`AniList request failed: ${res.status} ${res.statusText}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ''}`);
  }

  const json = await res.json();
  const media = json?.data?.Media ?? null;
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    // A 404 alongside a null Media is the "AniList doesn't have it" answer.
    const notFound = json.errors.some((e: { status?: number }) => e.status === 404);
    if (notFound && !media) return null;
    const messages = json.errors.map((e: { message?: string }) => e.message ?? 'unknown error').join('; ');
    throw new AniListCastError(`AniList GraphQL error: ${messages}`);
  }
  return media as RawCastMedia | null;
}

export interface AniListCastResult {
  ok: boolean;
  /** The stored entry — present whenever `ok`, even if its cast is empty. */
  entry?: AniListCastEntry;
  /** True when the entry was served from the slice rather than fetched. */
  cached: boolean;
  error?: string;
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
    if (cached) return { ok: true, entry: cached, cached: true };
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
