/**
 * AniList seiyuu filmography — every ANIME a voice actor is credited on, asked
 * from the PERSON's side. Public GraphQL API, no auth. Read-only.
 *
 * **Why this exists at all.** `cast.ts` fills `catalog/anilist_cast.json`, keyed
 * by title, one title at a time — lazily on a detail-page view plus the /stats
 * sweep over the statused list. `/credits/seiyuu/[id]` used to derive its
 * filmography by scanning that slice, which meant the pool it drew from was
 * essentially "titles the owner has already watched". Measured on the live store
 * when this was written: 715 cast entries out of 26,666 catalog titles, 689 of
 * them statused. So the filmography's `sans statut` filter could only ever
 * return nothing, and the page's central question — what has this seiyuu done
 * that I have NOT seen — was unanswerable by construction. For Shion Wakayama
 * (148220) the scan found 29 credits, all 29 watched; AniList has 63, of which
 * 62 are in the local catalog and 30 are unwatched.
 *
 * Asking AniList by staff id inverts that: coverage stops depending on what the
 * owner happens to have watched.
 *
 * **It persists rather than caching in-process**, unlike the per-anchor edge
 * caches in `/api/anime/recommendations/mix`. Those are ~1 request per anchor;
 * this is up to 30 throttled requests (~60s) for a prolific seiyuu, which is too
 * much to re-pay after every deploy. It lands in `catalog/anilist_seiyuu.json`
 * and the page is a plain local read from then on — the same lazily-filled,
 * fetched-once-ever shape as the cast slice it complements.
 */
import { getAnilistSeiyuu, upsertAnilistSeiyuu } from '@/lib/store';
import { anilistFetch, graphqlErrorMessage, httpErrorMessage } from '@/lib/providers/anilist/client';
import { cleanImage, type RawImage } from '@/lib/providers/anilist/cast';
import type { AniListSeiyuuCharacter, AniListSeiyuuCredit, AniListSeiyuuEntry } from '@/models/anime';

/**
 * AniList's hard cap on this connection: asking for 50 returns 25, exactly like
 * the `staff` connection in `sync.ts`. Depth comes from pages, not from a bigger
 * number — verified live 2026-08-27.
 */
const CREDITS_PER_PAGE = 25;

/**
 * Page ceiling, so one absurdly prolific person cannot hold an AniList slot for
 * minutes. 30 pages = 750 credits ≈ 63s at the shared ~2.1s throttle. Measured
 * live: Shion Wakayama 3 pages, Kana Hanazawa ~22, Takahiro Sakurai ~28 — so
 * this clears the real tail, and `complete: false` declares it when it doesn't.
 * Sorted newest-first, so a truncated filmography keeps the recent end, which is
 * the half the "what haven't I seen" question is actually about.
 */
const MAX_FILMOGRAPHY_PAGES = 30;

/**
 * `characterMedia` returns ONE edge per character, so a seiyuu voicing two
 * characters in one title yields two edges naming the same media — they are
 * merged below rather than rendered as two cards.
 *
 * ⚠️ `pageInfo.total`/`lastPage` report a placeholder (500/20) on every page but
 * the last, the same trap `sync.ts` documents for `staff.pageInfo`. Paging is
 * driven by `hasNextPage` alone; never size the loop from `total`.
 *
 * There is no `type` argument on this connection (verified live: AniList answers
 * `Unknown argument "type"`), so MANGA edges are filtered client-side. They are
 * rare here — 500 edges yielded 487 distinct anime on the sample.
 */
const FILMOGRAPHY_QUERY = `
query ($staffId: Int, $page: Int) {
  Staff(id: $staffId) {
    id
    name { full native }
    image { large medium }
    characterMedia(sort: START_DATE_DESC, page: $page, perPage: ${CREDITS_PER_PAGE}) {
      pageInfo { hasNextPage }
      edges {
        characterRole
        characters { id name { full native } image { large medium } }
        node { id idMal type }
      }
    }
  }
}`;

interface RawName { full?: string | null; native?: string | null }
interface RawCharacter { id?: number | null; name?: RawName | null; image?: RawImage | null }
interface RawMediaEdge {
  characterRole?: string | null;
  characters?: RawCharacter[] | null;
  node?: { id?: number | null; idMal?: number | null; type?: string | null } | null;
}
interface RawStaff {
  id?: number | null;
  name?: RawName | null;
  image?: RawImage | null;
  characterMedia?: {
    pageInfo?: { hasNextPage?: boolean | null } | null;
    edges?: RawMediaEdge[] | null;
  } | null;
}

class AniListSeiyuuError extends Error {}

/**
 * One page of credits. Returns `null` for "AniList has no such staff member",
 * which — exactly as in `cast.ts` — is a legitimate answer rather than a
 * failure: AniList replies with a GraphQL 404 and a null `Staff`. Anything else
 * throws, so a transient failure is never persisted as an empty filmography.
 */
async function fetchPage(staffId: number, page: number): Promise<RawStaff | null> {
  // `anilistFetch`, not the strict `anilistQuery`, because this caller has to
  // see the 404 status itself to tell a miss from an error.
  const res = await anilistFetch<{ Staff: RawStaff | null }>(FILMOGRAPHY_QUERY, { staffId, page });

  if (!res.ok && res.status !== 404) {
    throw new AniListSeiyuuError(httpErrorMessage(res));
  }

  const staff = res.body.data?.Staff ?? null;
  const errors = res.body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    if (errors.some(e => e.status === 404) && !staff) return null;
    throw new AniListSeiyuuError(graphqlErrorMessage(errors));
  }
  return staff;
}

function toCharacter(raw: RawCharacter, role: string): AniListSeiyuuCharacter | null {
  if (typeof raw.id !== 'number') return null;
  return {
    id: raw.id,
    name: raw.name?.full ?? '',
    nameNative: raw.name?.native ?? undefined,
    image: cleanImage(raw.image),
    role,
  };
}

export interface SeiyuuFilmographyResult {
  ok: boolean;
  /** The stored entry — present whenever `ok`, even if its credits are empty. */
  entry?: AniListSeiyuuEntry;
  /** True when the entry was served from the slice rather than fetched. */
  cached: boolean;
  error?: string;
}

/**
 * In-flight fetches, so a double mount (or a reload landing while the first
 * request is still paging) cannot start a second 60-second sweep for the same
 * person. Completed entries are NOT held here — the slice is the cache.
 */
const inFlight = new Map<number, Promise<SeiyuuFilmographyResult>>();

/**
 * Get one seiyuu's filmography, fetching + persisting it if it isn't stored yet.
 *
 * `force` bypasses the slice. Without it ANY existing entry short-circuits,
 * including one with an empty `credits` array — that empty records that AniList
 * was asked and had nothing, which is what keeps an unknown staff id from being
 * re-fetched on every page view.
 */
export function getOrFetchSeiyuuFilmography(staffId: number, force = false): Promise<SeiyuuFilmographyResult> {
  if (!force) {
    const cached = getAnilistSeiyuu(staffId);
    if (cached) return Promise.resolve({ ok: true, entry: cached, cached: true });
  }

  const running = inFlight.get(staffId);
  if (running) return running;

  const task = runFetch(staffId).finally(() => inFlight.delete(staffId));
  inFlight.set(staffId, task);
  return task;
}

async function runFetch(staffId: number): Promise<SeiyuuFilmographyResult> {
  try {
    // Merged by AniList media id: one edge per character, so a recast or a twin
    // arrives as several edges naming the same title.
    const byMedia = new Map<number, AniListSeiyuuCredit>();
    let name = '';
    let nameNative: string | undefined;
    let image: string | undefined;
    let complete = true;
    let page = 1;

    for (;;) {
      const staff = await fetchPage(staffId, page);
      // A null Staff on page 1 is "AniList doesn't have this person"; on a later
      // page it would be a shape change, and stopping is the right read either way.
      if (!staff) break;

      name = name || (staff.name?.full ?? '');
      nameNative = nameNative || (staff.name?.native ?? undefined);
      image = image || cleanImage(staff.image);

      for (const edge of staff.characterMedia?.edges ?? []) {
        const node = edge.node;
        // ANIME only — there is no server-side type filter on this connection.
        if (!node || typeof node.id !== 'number' || node.type !== 'ANIME') continue;
        const credit = byMedia.get(node.id) ?? {
          anilist_id: node.id,
          mal_id: typeof node.idMal === 'number' ? node.idMal : undefined,
          characters: [],
        };
        for (const raw of edge.characters ?? []) {
          const character = toCharacter(raw, edge.characterRole ?? '');
          // Guard the merge: the same character can legitimately arrive twice if
          // AniList re-orders between two pages of the same walk.
          if (character && !credit.characters.some(c => c.id === character.id)) {
            credit.characters.push(character);
          }
        }
        byMedia.set(node.id, credit);
      }

      if (!staff.characterMedia?.pageInfo?.hasNextPage) break;
      if (page >= MAX_FILMOGRAPHY_PAGES) { complete = false; break; }
      page++;
    }

    const entry: AniListSeiyuuEntry = {
      staff_id: staffId,
      name,
      nameNative,
      image,
      credits: Array.from(byMedia.values()),
      complete,
      fetched_at: new Date().toISOString(),
    };
    upsertAnilistSeiyuu(staffId, entry);
    return { ok: true, entry, cached: false };
  } catch (error) {
    // Deliberately NOT persisted: an empty entry short-circuits forever, so a
    // transient AniList failure must leave the slice untouched and retryable.
    return { ok: false, cached: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
