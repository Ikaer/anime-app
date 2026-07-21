/**
 * SIMKL rating writes (server-only) — the ONE deliberate exception to the
 * otherwise read-only SIMKL integration. Only user-initiated ratings are ever
 * pushed; nothing else is written to SIMKL. See docs/simkl/apirules.md.
 *
 * Type-key note: SIMKL's /sync/ratings example groups items by media root key
 * (`movies` / `shows` / `episodes`). Anime are first-class in the READ API
 * (top-level `anime` key), so the correct ratings bucket for anime is not
 * fully documented. We pick a bucket by media_type, then self-correct: if
 * SIMKL echoes the item under `not_found`, we retry the other bucket. The full
 * request body + SIMKL response are logged so the first live write is auditable.
 */
import { getSimklAuthData, isSimklTokenValid, simklPost } from '@/lib/providers/simkl/client';
import { SourceIds } from '@/models/anime';

export interface SimklRatingResult {
  ok: boolean;                 // remote write succeeded AND item was matched
  matched: boolean;            // SIMKL matched the item (not in `not_found`)
  status?: number;             // HTTP status of the final attempt
  bucket?: string;             // which root key finally matched
  error?: string;
}

type RatingBucket = 'shows' | 'movies';

/** Bucket order to try, most-likely first, given the anime's MAL media_type. */
function bucketOrder(mediaType?: string): RatingBucket[] {
  return (mediaType || '').toLowerCase() === 'movie' ? ['movies', 'shows'] : ['shows', 'movies'];
}

interface RawRatingResponse {
  added?: { movies?: number; shows?: number; episodes?: number };
  not_found?: { movies?: unknown[]; shows?: unknown[]; episodes?: unknown[] };
}

/** True if SIMKL reported nothing matched (item landed in `not_found`). */
function isUnmatched(raw: RawRatingResponse, bucket: RatingBucket): boolean {
  const nf = raw.not_found?.[bucket];
  return Array.isArray(nf) && nf.length > 0;
}

async function attempt(
  endpoint: string,
  bucket: RatingBucket,
  item: Record<string, unknown>,
  token: string,
): Promise<{ status: number; unmatched: boolean; text: string }> {
  const body = { [bucket]: [item] };
  const res = await simklPost(endpoint, token, body);
  const text = await res.text();
  console.log(`[simkl-rating] ${endpoint} bucket=${bucket} status=${res.status} req=${JSON.stringify(body)} res=${text}`);
  let unmatched = false;
  if (res.ok && text) {
    try { unmatched = isUnmatched(JSON.parse(text) as RawRatingResponse, bucket); } catch { /* non-JSON: treat as matched */ }
  }
  return { status: res.status, unmatched, text };
}

/**
 * Set (score 1-10) or clear (score 0) the user's SIMKL rating for one anime.
 * Matches by `ids.mal` (+ `simkl` when known). Non-throwing: returns a result
 * the caller surfaces in the UI — a failure here must not be silent, since a
 * SIMKL-first effective score would otherwise hide the divergence.
 */
export async function pushSimklRating(
  malId: number,
  score: number,
  opts: { simklId?: number; mediaType?: string } = {},
): Promise<SimklRatingResult> {
  const { token } = getSimklAuthData();
  if (!token || !isSimklTokenValid(token)) {
    return { ok: false, matched: false, error: 'Not authenticated with SIMKL' };
  }

  const endpoint = score > 0 ? '/sync/ratings' : '/sync/ratings/remove';
  const ids: SourceIds = { mal: malId };
  if (opts.simklId) ids.simkl = opts.simklId;
  const item: Record<string, unknown> = score > 0 ? { rating: score, ids } : { ids };

  try {
    const [primary, secondary] = bucketOrder(opts.mediaType);

    let res = await attempt(endpoint, primary, item, token.access_token);
    if (res.status >= 200 && res.status < 300 && !res.unmatched) {
      return { ok: true, matched: true, status: res.status, bucket: primary };
    }

    // Self-correct the bucket unknown: retry under the other root key.
    res = await attempt(endpoint, secondary, item, token.access_token);
    if (res.status >= 200 && res.status < 300 && !res.unmatched) {
      return { ok: true, matched: true, status: res.status, bucket: secondary };
    }

    return {
      ok: false,
      matched: false,
      status: res.status,
      error: res.status >= 400 ? `SIMKL ${res.status}: ${res.text}` : 'SIMKL did not match this title',
    };
  } catch (error) {
    return { ok: false, matched: false, error: error instanceof Error ? error.message : 'Unknown SIMKL error' };
  }
}
