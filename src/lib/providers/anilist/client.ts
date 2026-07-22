/**
 * The ONE AniList GraphQL transport: endpoint, throttle, 429 retry, optional
 * Bearer header.
 *
 * **Every AniList request in the process must go through here**, because the
 * throttle is a single module-level slot allocator. Independent throttles cannot
 * cooperate: a meta sync and a cast sweep each pacing themselves at 28 req/min
 * together exceed AniList's degraded 30 req/min ceiling.
 *
 * **The queries stay with their callers.** The per-query constraints
 * (`Page.media` vs an aliased `Media`, exactly one id filter per query,
 * complexity ceilings) are documented where those queries live; this module
 * knows nothing about them. It moves bytes, not meaning.
 *
 * Three entry points, because the callers genuinely disagree about what an error
 * is: `anilistQuery` (strict — any HTTP or GraphQL error throws), `anilistFetch`
 * (raw envelope + status, for `cast.ts`, which reads a 404 as "AniList doesn't
 * have this title" rather than as a failure) and `anilistGraphQL` (the
 * authenticated envelope-passthrough `write.ts` expects, since AniList reports
 * business errors in `errors` with a 200).
 */

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co';

/**
 * Conservative spacing between AniList requests (~28 req/min), safely under the
 * documented degraded limit of 30/min (normally 90/min). One value for the whole
 * process.
 */
export const ANILIST_MIN_DELAY_MS = 2100;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Earliest timestamp the next request may go out at. Each caller claims a slot
 * before its fetch and pushes the marker forward, so N concurrent sweeps
 * interleave on one 2.1s cadence instead of running N of them in parallel.
 */
let nextSlotAt = 0;

async function takeSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + ANILIST_MIN_DELAY_MS;
  if (slot > now) await sleep(slot - now);
}

/**
 * Push every waiting caller back after a 429 — not just the one that got it.
 * The rate limit is per account/IP, so a sibling sweep holding an earlier slot
 * would otherwise walk straight into the same wall.
 */
function backOff(ms: number): void {
  nextSlotAt = Math.max(nextSlotAt, Date.now() + ms);
}

export interface AnilistGraphQLResult<T> {
  data?: T;
  errors?: Array<{ message?: string; status?: number }>;
}

export interface AnilistResponse<T> {
  status: number;
  statusText: string;
  ok: boolean;
  body: AnilistGraphQLResult<T>;
}

/** Transport-level failure: unreachable, or a response that wasn't JSON at all. */
export class AnilistTransportError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'AnilistTransportError';
  }
}

export interface AnilistRequestOptions {
  /** Sent as `Authorization: Bearer` when present. Anonymous otherwise. */
  accessToken?: string | null;
}

/**
 * One throttled AniList request. Retries ONCE on 429, honoring `Retry-After`
 * (defaulting to 60s), then gives up. Returns the parsed envelope alongside the
 * HTTP status without interpreting either — a non-2xx is NOT an exception here,
 * because a 404 is how AniList answers "no such title" and `cast.ts` needs to
 * tell that apart from a real failure.
 */
export async function anilistFetch<T>(
  query: string,
  variables: Record<string, unknown>,
  options: AnilistRequestOptions = {},
  retryOn429 = true
): Promise<AnilistResponse<T>> {
  await takeSlot();

  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429) {
    if (!retryOn429) {
      throw new AnilistTransportError('AniList rate limit exceeded (retry already attempted)', 429);
    }
    const retryAfterHeader = res.headers.get('Retry-After');
    const parsed = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 60_000;
    const retryAfterMs = Number.isFinite(parsed) ? parsed : 60_000;
    backOff(retryAfterMs);
    await sleep(retryAfterMs);
    return anilistFetch<T>(query, variables, options, false);
  }

  const text = await res.text().catch(() => '');
  let body: AnilistGraphQLResult<T>;
  try {
    body = text ? (JSON.parse(text) as AnilistGraphQLResult<T>) : {};
  } catch {
    throw new AnilistTransportError(
      `AniList returned non-JSON (${res.status}): ${text.slice(0, 200)}`,
      res.status
    );
  }

  return { status: res.status, statusText: res.statusText, ok: res.ok, body };
}

/** The shared wording for a non-2xx, kept identical across every caller. */
export function httpErrorMessage(res: { status: number; statusText: string }, snippet = ''): string {
  return `AniList request failed: ${res.status} ${res.statusText}${snippet ? ` — ${snippet.slice(0, 500)}` : ''}`;
}

/** The shared wording for a populated `errors` array. */
export function graphqlErrorMessage(errors: Array<{ message?: string }>): string {
  return `AniList GraphQL error: ${errors.map(e => e.message ?? 'unknown error').join('; ')}`;
}

/**
 * Strict variant: any HTTP failure or GraphQL `errors` entry throws, and the
 * `data` payload is returned directly. This is what the catalog-wide sweeps want
 * — for them a bad response is a failed batch, full stop.
 */
export async function anilistQuery<T>(
  query: string,
  variables: Record<string, unknown>,
  options: AnilistRequestOptions = {}
): Promise<T | undefined> {
  const res = await anilistFetch<T>(query, variables, options);

  if (!res.ok) {
    throw new Error(httpErrorMessage(res));
  }
  if (Array.isArray(res.body.errors) && res.body.errors.length > 0) {
    throw new Error(graphqlErrorMessage(res.body.errors));
  }
  return res.body.data;
}

/**
 * Authenticated envelope-passthrough. Returns `errors` untouched rather than
 * throwing on them — AniList reports business failures (unknown media id,
 * permission) in `errors` with a 200, and `write.ts` maps those onto its own
 * `WriteOutcome` shape. Only a transport failure with no error body throws.
 */
export async function anilistGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string
): Promise<AnilistGraphQLResult<T>> {
  const res = await anilistFetch<T>(query, variables, { accessToken });
  if (!res.ok && !res.body.errors) {
    throw new Error(httpErrorMessage(res));
  }
  return res.body;
}
