import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import {
  AppSettings,
  SETTINGS_FIELDS,
  SECRET_FIELDS,
  readSettings,
  saveSettings,
  resolveSetting,
} from '@/lib/settings';
import {
  BootstrapConfig,
  readBootstrapConfig,
  writeBootstrapConfig,
  bootstrapConfigFile,
} from '@/lib/bootstrap';
import { DATA_PATH } from '@/lib/jsonStore';
import { LOGS_PATH } from '@/lib/connectionLog';
import { getMalRedirectUri, getSimklRedirectUri } from '@/lib/redirectUri';

/**
 * Redacted settings API. GET never returns a secret's value (only `{ set }`);
 * POST leaves a stored secret untouched when its field arrives blank. The one
 * genuinely new attack surface over env config is this browser endpoint, so the
 * redaction rules live here. See docs/SETUP-AND-CONFIG.md § Security posture.
 */

interface FieldStatus {
  secret: boolean;
  /** Has a value from settings.json OR env. */
  set: boolean;
  /** The effective value comes from env (no stored override). */
  fromEnv: boolean;
  /** Raw stored value — NON-SECRET fields only, so the form shows what's persisted. */
  stored?: string;
}

// The two Tier-0 (bootstrap) paths get their own shape: they live in
// ~/.anime-app/config.json (NOT settings.json), an env var still wins over the
// file, and a change only takes effect on restart (resolved at import time).
interface BootstrapFieldStatus {
  /** Value stored in config.json (editable), '' if none. */
  stored: string;
  /** What the path resolves to now (env → config → default) — applied on restart. */
  resolved: string;
  /** An env var is set, which overrides the config file until removed. */
  fromEnv: boolean;
}

const BOOTSTRAP_KEYS: (keyof BootstrapConfig)[] = ['dataPath', 'logsPath'];

function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const stored = readSettings();
  const fields: Record<string, FieldStatus> = {};

  for (const field of SETTINGS_FIELDS) {
    const secret = SECRET_FIELDS.includes(field);
    const storedValue = stored[field];
    const hasStored = typeof storedValue === 'string' && storedValue.trim() !== '';
    const set = resolveSetting(field) !== undefined;
    fields[field] = {
      secret,
      set,
      fromEnv: !hasStored && set,
      ...(secret ? {} : { stored: hasStored ? (storedValue as string) : '' }),
    };
  }

  const bootStored = readBootstrapConfig();
  const bootstrap: Record<keyof BootstrapConfig, BootstrapFieldStatus> = {
    dataPath: {
      stored: bootStored.dataPath ?? '',
      resolved: DATA_PATH, // frozen at boot — the folder actually in use now
      fromEnv: !!process.env.DATA_PATH,
    },
    logsPath: {
      stored: bootStored.logsPath ?? '',
      resolved: LOGS_PATH, // frozen at boot
      fromEnv: !!process.env.LOGS_PATH,
    },
  };

  res.json({
    fields,
    bootstrap,
    // The exact URI each OAuth flow will send — what the user must register with
    // the provider. Same derivation as the flow (env → request host).
    derivedRedirectUris: {
      mal: getMalRedirectUri(req),
      simkl: getSimklRedirectUri(req),
    },
  });
}

function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // ── Tier 1: settings.json ──
  const next: AppSettings = { ...readSettings() };
  for (const field of SETTINGS_FIELDS) {
    if (!(field in body)) continue; // not submitted → leave as-is
    const raw = body[field];
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (SECRET_FIELDS.includes(field)) {
      // Blank secret = "no change" (the GET never handed the value back).
      if (value === '') continue;
      next[field] = value;
    } else {
      // Blank non-secret = the user cleared the field.
      if (value === '') delete next[field];
      else next[field] = value;
    }
  }
  saveSettings(next);

  // ── Tier 0: ~/.anime-app/config.json (data/log folders) ──
  const bootPatch: BootstrapConfig = {};
  let touchedBoot = false;
  for (const key of BOOTSTRAP_KEYS) {
    if (!(key in body)) continue;
    touchedBoot = true;
    const raw = body[key];
    const value = typeof raw === 'string' ? raw.trim() : '';
    bootPatch[key] = value === '' ? undefined : value; // blank clears the key
  }
  if (touchedBoot) {
    const merged = { ...readBootstrapConfig(), ...bootPatch };
    const wouldBeEmpty = !merged.dataPath && !merged.logsPath;
    // Don't create an empty config file for nothing; still write to clear an
    // existing one.
    if (!wouldBeEmpty || fs.existsSync(bootstrapConfigFile())) {
      writeBootstrapConfig(bootPatch);
    }
  }

  handleGet(req, res); // echo the redacted post-write state
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error('Settings API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
