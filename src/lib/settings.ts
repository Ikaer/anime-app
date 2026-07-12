import fs from 'fs';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/jsonStore';

/**
 * Tier 1 — runtime app settings. Everything that used to be an env var *except*
 * the data/log folders (those are Tier 0, see bootstrap.ts). Stored in a sparse
 * `settings.json` next to `mal_auth.json` under `DATA_PATH`. See
 * docs/SETUP-AND-CONFIG.md.
 *
 * Precedence is per-field, with NO seeding from env: `settings.json[field] ??
 * process.env[ENV] ?? default`. Sparse-on-purpose — a Docker/env deploy never
 * writes a `settings.json` and keeps running purely on env; a UI user writes only
 * the fields they change. That avoids the clobber trap either direction.
 *
 * Server-only: uses `fs` and reads env; must never reach the client bundle.
 */

export interface AppSettings {
  malClientId?: string;
  simklClientId?: string;
  simklClientSecret?: string;
  simklAppName?: string;
  cronSecret?: string;
}

/**
 * The env var backing each setting, for the `?? env` fallback.
 *
 * NOTE: the OAuth **redirect URIs** are deliberately NOT here — they're derived
 * from the request host ([redirectUri.ts](./redirectUri.ts)), with the
 * `MAL_REDIRECT_URI` / `SIMKL_REDIRECT_URI` env vars as a silent escape hatch.
 * There's no scenario for a redirect host other than the one serving the app.
 */
export const SETTINGS_ENV_MAP: Record<keyof AppSettings, string> = {
  malClientId: 'MAL_CLIENT_ID',
  simklClientId: 'SIMKL_CLIENT_ID',
  simklClientSecret: 'SIMKL_CLIENT_SECRET',
  simklAppName: 'SIMKL_APP_NAME',
  cronSecret: 'CRON_SECRET',
};

/**
 * The only genuinely sensitive fields. The GET redacts these to `{ set: true }`
 * and never returns their value; client ids / redirect uris / app-name are
 * public-by-design (client ids ship in OAuth redirect URLs).
 */
export const SECRET_FIELDS: ReadonlyArray<keyof AppSettings> = ['simklClientSecret', 'cronSecret'];

export const SETTINGS_FIELDS = Object.keys(SETTINGS_ENV_MAP) as (keyof AppSettings)[];

const SETTINGS_FILE = dataFile('settings.json');

/** Raw stored settings (sparse — only fields the user set in the UI). */
export function readSettings(): AppSettings {
  return readJsonFile<AppSettings>(SETTINGS_FILE, {});
}

/**
 * Persist settings. `next` is the full object to store; callers build it by
 * merging their patch onto `readSettings()` (see the settings API for the
 * blank-secret-leaves-untouched rule). Empty-string fields are dropped so the
 * store stays sparse. Written `0600` (best-effort — a no-op on Windows).
 */
export function saveSettings(next: AppSettings): void {
  const sparse: AppSettings = {};
  for (const field of SETTINGS_FIELDS) {
    const value = next[field];
    if (typeof value === 'string' && value.trim() !== '') {
      sparse[field] = value.trim();
    }
  }
  writeJsonFile(SETTINGS_FILE, sparse);
  try {
    fs.chmodSync(SETTINGS_FILE, 0o600);
  } catch {
    // chmod is a best-effort no-op on Windows; ignore.
  }
}

/** Resolve one field: stored value → env var → undefined. */
export function resolveSetting(field: keyof AppSettings): string | undefined {
  const stored = readSettings()[field];
  if (typeof stored === 'string' && stored.trim() !== '') return stored.trim();
  const env = process.env[SETTINGS_ENV_MAP[field]];
  if (typeof env === 'string' && env.trim() !== '') return env.trim();
  return undefined;
}

/** Whether a field has a value from either source — used by the redacted GET. */
export function isSettingSet(field: keyof AppSettings): boolean {
  return resolveSetting(field) !== undefined;
}

// ── Typed getters used by the consumers (bake in the same defaults the env
//    consumers used to carry, so `?? env ?? default` lives in one place) ──

export function getMalClientId(): string | undefined {
  return resolveSetting('malClientId');
}

export function getSimklClientId(): string {
  return resolveSetting('simklClientId') || '';
}

export function getSimklClientSecret(): string | undefined {
  return resolveSetting('simklClientSecret');
}

export function getSimklAppName(): string {
  return resolveSetting('simklAppName') || 'my-app-name';
}

export function getCronSecret(): string | undefined {
  return resolveSetting('cronSecret');
}
