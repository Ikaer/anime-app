import fs from 'fs';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import type { LocalPrecedenceMode } from '@/lib/animeUtils';

export type { LocalPrecedenceMode };
export type LocalProviderEnabled = 'auto' | 'on' | 'off';

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
  anilistClientId?: string;
  anilistClientSecret?: string;
  cronSecret?: string;
  // ── Non-secret preferences (docs/localRating/): enum toggles, NOT secrets and
  //    with NO env backing, so they're kept out of SETTINGS_ENV_MAP/SECRET_FIELDS
  //    (echoed plainly, never redacted) and persisted via PREFERENCE_FIELDS. ──
  /** Enable the in-app local personal-data provider. `auto` = on iff no writable external provider. */
  localProviderEnabled?: LocalProviderEnabled;
  /** Where the local tier sits in personal-state precedence. `auto` resolves via the same predicate. */
  localPrecedenceMode?: LocalPrecedenceMode;
}

/**
 * The env var backing each setting, for the `?? env` fallback.
 *
 * NOTE: the OAuth **redirect URIs** are deliberately NOT here — they're derived
 * from the request host ([redirectUri.ts](./redirectUri.ts)), with the
 * `MAL_REDIRECT_URI` / `SIMKL_REDIRECT_URI` env vars as a silent escape hatch.
 * There's no scenario for a redirect host other than the one serving the app.
 */
/**
 * The env-backed string fields (secrets + public client ids) — the original
 * `AppSettings` members. The `localProvider*` preference enums are deliberately
 * NOT here: they have no env fallback and aren't redacted (see PREFERENCE_FIELDS).
 */
export type EnvBackedField =
  | 'malClientId'
  | 'simklClientId'
  | 'simklClientSecret'
  | 'simklAppName'
  | 'anilistClientId'
  | 'anilistClientSecret'
  | 'cronSecret';

export const SETTINGS_ENV_MAP: Record<EnvBackedField, string> = {
  malClientId: 'MAL_CLIENT_ID',
  simklClientId: 'SIMKL_CLIENT_ID',
  simklClientSecret: 'SIMKL_CLIENT_SECRET',
  simklAppName: 'SIMKL_APP_NAME',
  anilistClientId: 'ANILIST_CLIENT_ID',
  anilistClientSecret: 'ANILIST_CLIENT_SECRET',
  cronSecret: 'CRON_SECRET',
};

/**
 * The only genuinely sensitive fields. The GET redacts these to `{ set: true }`
 * and never returns their value; client ids / redirect uris / app-name are
 * public-by-design (client ids ship in OAuth redirect URLs).
 */
export const SECRET_FIELDS: ReadonlyArray<EnvBackedField> = ['simklClientSecret', 'anilistClientSecret', 'cronSecret'];

export const SETTINGS_FIELDS = Object.keys(SETTINGS_ENV_MAP) as EnvBackedField[];

/**
 * Non-secret preference fields (docs/localRating/) — enum toggles with no env
 * backing. Persisted alongside the secret fields in `settings.json`, but handled
 * separately (own valid-value validation, echoed plainly, never redacted).
 */
export type PreferenceField = 'localProviderEnabled' | 'localPrecedenceMode';

export const PREFERENCE_VALUES: Record<PreferenceField, readonly string[]> = {
  localProviderEnabled: ['auto', 'on', 'off'],
  localPrecedenceMode: ['auto', 'localTop', 'localBottom'],
};

export const PREFERENCE_FIELDS = Object.keys(PREFERENCE_VALUES) as PreferenceField[];

export const PREFERENCE_DEFAULTS: Record<PreferenceField, string> = {
  localProviderEnabled: 'auto',
  localPrecedenceMode: 'auto',
};

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
  // Non-secret preference enums: persist only recognized, non-default values so
  // the store stays sparse (an unset/`auto`-default field is simply absent).
  for (const field of PREFERENCE_FIELDS) {
    const value = next[field];
    if (typeof value === 'string' && PREFERENCE_VALUES[field].includes(value) && value !== PREFERENCE_DEFAULTS[field]) {
      sparse[field] = value as never;
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
export function resolveSetting(field: EnvBackedField): string | undefined {
  const stored = readSettings()[field];
  if (typeof stored === 'string' && stored.trim() !== '') return stored.trim();
  const env = process.env[SETTINGS_ENV_MAP[field]];
  if (typeof env === 'string' && env.trim() !== '') return env.trim();
  return undefined;
}

/** Whether a field has a value from either source — used by the redacted GET. */
export function isSettingSet(field: EnvBackedField): boolean {
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

export function getAnilistClientId(): string | undefined {
  return resolveSetting('anilistClientId');
}

export function getAnilistClientSecret(): string | undefined {
  return resolveSetting('anilistClientSecret');
}

export function getCronSecret(): string | undefined {
  return resolveSetting('cronSecret');
}

// ── Non-secret preference getters (docs/localRating/). No env fallback; an
//    unrecognized/absent stored value resolves to the `auto` default. ──

function readPreference<T extends string>(field: PreferenceField): T {
  const stored = readSettings()[field];
  if (typeof stored === 'string' && PREFERENCE_VALUES[field].includes(stored)) return stored as T;
  return PREFERENCE_DEFAULTS[field] as T;
}

export function getLocalProviderEnabledMode(): LocalProviderEnabled {
  return readPreference<LocalProviderEnabled>('localProviderEnabled');
}

export function getLocalPrecedenceMode(): LocalPrecedenceMode {
  return readPreference<LocalPrecedenceMode>('localPrecedenceMode');
}
