/**
 * AniList OAuth token store + authenticated GraphQL transport
 * (docs/ANILIST-OAUTH.md). The login tier above `anilistPersonalSync.ts`'s
 * anonymous read-by-username: a viewer token unlocks private-list reads and —
 * the point of this module — `SaveMediaListEntry` writes (see anilistWrite.ts).
 *
 * Shaped after `simkl.ts`, with three deliberate differences forced by AniList's
 * OAuth2 implementation (verified against docs.anilist.co/guide/auth/):
 *
 *  1. **No scopes.** A token carries (almost) full access to the user's data.
 *  2. **No refresh tokens.** Tokens are long-lived — valid ONE YEAR from issue —
 *     and when one expires the user simply re-authenticates. So there is no
 *     refresh path to write, unlike MAL's. `expires_in` is honored as-is.
 *  3. **`state` is not documented as round-tripped.** We still SEND one (it costs
 *     nothing and CSRF-protects us if AniList does echo it), but the callback
 *     only rejects a state that is *present and bad* — a missing state is
 *     accepted rather than failing every login. This is the one spot that
 *     deliberately does NOT copy SIMKL's hard `consumeOAuthState` reject.
 *
 * Server-only (reads/writes JSON under DATA_PATH).
 */
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/jsonStore';

const ANILIST_AUTH_FILE = dataFile('auth/anilist.json');
const ANILIST_STATE_FILE = dataFile('auth/oauth_state_anilist.json');
const STATE_TTL_MS = 10 * 60_000;

export const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
export const ANILIST_AUTHORIZE_URL = 'https://anilist.co/api/v2/oauth/authorize';
export const ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token';

export interface AniListAuthData {
  access_token: string;
  token_type: string;
  /** Seconds. AniList issues ~1 year (31_536_000). */
  expires_in: number;
  /** Timestamp, set by us on exchange (AniList doesn't send one). */
  created_at: number;
}

export interface AniListViewer {
  id: number;
  name: string;
  /** The user's own display scale. We write `scoreRaw` (0-100) to stay
   *  independent of it, but it's useful to show and to read back with. */
  scoreFormat?: string;
}

export function getAnilistAuthData(): { user: AniListViewer | null; token: AniListAuthData | null } {
  return readJsonFile(ANILIST_AUTH_FILE, { user: null, token: null });
}

export function saveAnilistAuthData(user: AniListViewer | null, token: AniListAuthData | null): void {
  writeJsonFile(ANILIST_AUTH_FILE, { user, token });
}

export function clearAnilistAuthData(): void {
  saveAnilistAuthData(null, null);
}

export function isAnilistTokenValid(token: AniListAuthData | null): boolean {
  if (!token) return false;
  return Date.now() < token.created_at + token.expires_in * 1000;
}

/** The access token if we have a live one, else null. */
export function getAnilistAccessToken(): string | null {
  const { token } = getAnilistAuthData();
  return token && isAnilistTokenValid(token) ? token.access_token : null;
}

// ── CSRF state (best-effort; see the header note on AniList not echoing it) ──

export function saveOAuthState(state: string): void {
  const states = readJsonFile<Record<string, number>>(ANILIST_STATE_FILE, {});
  const now = Date.now();
  Object.keys(states).forEach(key => {
    if (now - states[key] > STATE_TTL_MS) delete states[key];
  });
  states[state] = now;
  writeJsonFile(ANILIST_STATE_FILE, states);
}

export function consumeOAuthState(state: string): boolean {
  const states = readJsonFile<Record<string, number>>(ANILIST_STATE_FILE, {});
  const issuedAt = states[state];
  delete states[state];
  writeJsonFile(ANILIST_STATE_FILE, states);
  if (!issuedAt) return false;
  return Date.now() - issuedAt <= STATE_TTL_MS;
}

// ── Authenticated GraphQL ────────────────────────────────────────────────────

export interface AnilistGraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string; status?: number }>;
}

/**
 * POST a GraphQL document to AniList with a Bearer token. Returns the parsed
 * envelope untouched — AniList reports business errors in `errors` with a 200,
 * so callers MUST check `errors`, not just the HTTP status.
 */
export async function anilistGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string
): Promise<AnilistGraphQLResult<T>> {
  const response = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let parsed: AnilistGraphQLResult<T>;
  try {
    parsed = JSON.parse(text) as AnilistGraphQLResult<T>;
  } catch {
    throw new Error(`AniList returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
  }
  // A transport-level failure with no GraphQL error body still has to surface.
  if (!response.ok && !parsed.errors) {
    throw new Error(`AniList request failed: ${response.status} ${text.slice(0, 200)}`);
  }
  return parsed;
}

const VIEWER_QUERY = `
query {
  Viewer {
    id
    name
    mediaListOptions { scoreFormat }
  }
}`;

interface ViewerResponse {
  Viewer: { id: number; name: string; mediaListOptions?: { scoreFormat?: string } } | null;
}

/** Identify the token holder. Used at callback time to store who logged in. */
export async function fetchAnilistViewer(accessToken: string): Promise<AniListViewer | null> {
  const result = await anilistGraphQL<ViewerResponse>(VIEWER_QUERY, {}, accessToken);
  if (result.errors?.length || !result.data?.Viewer) return null;
  const v = result.data.Viewer;
  return { id: v.id, name: v.name, scoreFormat: v.mediaListOptions?.scoreFormat };
}
