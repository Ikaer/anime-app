import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { getSimklAppName, getSimklClientId } from '@/lib/settings';

const SIMKL_AUTH_FILE = dataFile('auth/simkl.json');
const SIMKL_STATE_FILE = dataFile('auth/oauth_state_simkl.json');
const STATE_TTL_MS = 10 * 60_000;

export interface SimklAuthData {
  access_token: string;
  token_type: string;
  scope?: string;
  expires_in: number;
  created_at: number; // timestamp, set by us on exchange
}

export interface SimklUser {
  user?: {
    name?: string;
  };
  account?: {
    id?: number;
  };
  [key: string]: unknown;
}

export function getSimklAuthData(): { user: SimklUser | null; token: SimklAuthData | null } {
  return readJsonFile(SIMKL_AUTH_FILE, { user: null, token: null });
}

export function saveSimklAuthData(user: SimklUser | null, token: SimklAuthData | null): void {
  writeJsonFile(SIMKL_AUTH_FILE, { user, token });
}

export function clearSimklAuthData(): void {
  saveSimklAuthData(null, null);
}

export function isSimklTokenValid(token: SimklAuthData | null): boolean {
  if (!token) return false;
  const now = Date.now();
  const tokenExpiry = token.created_at + token.expires_in * 1000;
  return now < tokenExpiry;
}

// CSRF-only state tracking for the OAuth callback (no PKCE verifier needed: Simkl is a confidential client).
export function saveOAuthState(state: string): void {
  const states = readJsonFile<Record<string, number>>(SIMKL_STATE_FILE, {});
  const now = Date.now();
  Object.keys(states).forEach(key => {
    if (now - states[key] > STATE_TTL_MS) delete states[key];
  });
  states[state] = now;
  writeJsonFile(SIMKL_STATE_FILE, states);
}

export function consumeOAuthState(state: string): boolean {
  const states = readJsonFile<Record<string, number>>(SIMKL_STATE_FILE, {});
  const issuedAt = states[state];
  delete states[state];
  writeJsonFile(SIMKL_STATE_FILE, states);
  if (!issuedAt) return false;
  return Date.now() - issuedAt <= STATE_TTL_MS;
}

const SIMKL_CHECKPOINT_FILE = dataFile('sync/simkl_checkpoint.json');
const SIMKL_APP_VERSION = '1.0';
// client_id / app-name resolve at request time via the settings store
// (settings.json ?? env ?? default). See @/lib/settings.

export interface SimklCheckpoint {
  // The activities.anime.all timestamp, stored EXACTLY as received (ISO 8601 UTC).
  lastActivityAll: string | null;
  // The activities.anime.removed_from_list timestamp, for deletion reconciliation.
  lastRemovedFromList: string | null;
  // The activities.anime.rated_at timestamp. Tracked separately because SIMKL's
  // all-items `date_from` delta does NOT surface rating-only changes (verified
  // live: a freshly-rated title is absent from all-items?date_from=…). When this
  // advances we must fall back to a FULL pull to capture the new rating.
  lastRatedAt?: string | null;
}

export function getSimklCheckpoint(): SimklCheckpoint {
  return readJsonFile<SimklCheckpoint>(SIMKL_CHECKPOINT_FILE, {
    lastActivityAll: null,
    lastRemovedFromList: null,
    lastRatedAt: null,
  });
}

export function saveSimklCheckpoint(cp: SimklCheckpoint): void {
  writeJsonFile(SIMKL_CHECKPOINT_FILE, cp);
}

/**
 * Authenticated SIMKL GET. Injects the required client_id/app-name/app-version
 * query params and Authorization/User-Agent headers on every call.
 * `pathAndQuery` starts with '/' (e.g. '/sync/all-items/anime?extended=ids_only').
 */
export async function simklFetch(pathAndQuery: string, accessToken: string): Promise<Response> {
  const appName = getSimklAppName();
  const url = new URL(`https://api.simkl.com${pathAndQuery}`);
  url.searchParams.set('client_id', getSimklClientId());
  url.searchParams.set('app-name', appName);
  url.searchParams.set('app-version', SIMKL_APP_VERSION);
  return fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': `${appName}/${SIMKL_APP_VERSION}`,
    },
  });
}

/**
 * Authenticated SIMKL POST (JSON body). Same required client_id/app-name/
 * app-version query params + Authorization/User-Agent headers as simklFetch.
 * SIMKL serializes writes with a 20s per-user lock and caps POSTs at ~1/sec —
 * callers must issue writes serially (see docs/simkl/apirules.md).
 */
export async function simklPost(pathAndQuery: string, accessToken: string, body: unknown): Promise<Response> {
  const appName = getSimklAppName();
  const url = new URL(`https://api.simkl.com${pathAndQuery}`);
  url.searchParams.set('client_id', getSimklClientId());
  url.searchParams.set('app-name', appName);
  url.searchParams.set('app-version', SIMKL_APP_VERSION);
  return fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': `${appName}/${SIMKL_APP_VERSION}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
