import fs from 'fs';
import path from 'path';

const DATA_PATH = process.env.DATA_PATH || '/app/data';
const SIMKL_AUTH_FILE = path.join(DATA_PATH, 'simkl_auth.json');
const SIMKL_STATE_FILE = path.join(DATA_PATH, 'simkl_oauth_state.json');
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

function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true, mode: 0o755 });
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return defaultValue;
  }
}

function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    ensureDataDirectory();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    throw error;
  }
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

const SIMKL_CHECKPOINT_FILE = path.join(DATA_PATH, 'simkl_sync_checkpoint.json');
const SIMKL_APP_NAME = process.env.SIMKL_APP_NAME || 'my-app-name';
const SIMKL_APP_VERSION = '1.0';
const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID || '';

export interface SimklCheckpoint {
  // The activities.anime.all timestamp, stored EXACTLY as received (ISO 8601 UTC).
  lastActivityAll: string | null;
  // The activities.anime.removed_from_list timestamp, for deletion reconciliation.
  lastRemovedFromList: string | null;
}

export function getSimklCheckpoint(): SimklCheckpoint {
  return readJsonFile<SimklCheckpoint>(SIMKL_CHECKPOINT_FILE, {
    lastActivityAll: null,
    lastRemovedFromList: null,
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
  const url = new URL(`https://api.simkl.com${pathAndQuery}`);
  url.searchParams.set('client_id', SIMKL_CLIENT_ID);
  url.searchParams.set('app-name', SIMKL_APP_NAME);
  url.searchParams.set('app-version', SIMKL_APP_VERSION);
  return fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': `${SIMKL_APP_NAME}/${SIMKL_APP_VERSION}`,
    },
  });
}
