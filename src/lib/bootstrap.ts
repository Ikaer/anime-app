import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Tier 0 — the bootstrap resolver. It answers the one question that cannot live
 * inside `DATA_PATH`: *where is `DATA_PATH`?* (You can't store the location of the
 * data folder inside the data folder.) See docs/SETUP-AND-CONFIG.md.
 *
 * Resolution order, per field: `env var → OS-config bootstrap file → default`.
 *
 * Both the default data/log folders and the bootstrap file live at a fixed,
 * path-independent **OS config location** (`~/.anime-app/`, `%APPDATA%\anime-app\`
 * on Windows) — deliberately NOT `./data` relative to cwd, so a secrets-bearing
 * `settings.json` can never land in the git working tree or a Docker build context.
 *
 * Server-only: uses `fs`/`os` and must never reach the client bundle. Values are
 * resolved once at import time (module-level consts downstream), so changing the
 * folders at runtime requires a restart — an accepted trade for a single-user app.
 */

/** `~/.anime-app` on POSIX, `%APPDATA%\anime-app` on Windows. */
export function appHomeDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'anime-app');
  }
  return path.join(os.homedir(), '.anime-app');
}

/** The Tier-0 bootstrap file: the only config that lives outside `DATA_PATH`. */
export function bootstrapConfigFile(): string {
  return path.join(appHomeDir(), 'config.json');
}

export interface BootstrapConfig {
  dataPath?: string;
  logsPath?: string;
}

export function readBootstrapConfig(): BootstrapConfig {
  try {
    const file = bootstrapConfigFile();
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return {
      dataPath: typeof parsed.dataPath === 'string' ? parsed.dataPath : undefined,
      logsPath: typeof parsed.logsPath === 'string' ? parsed.logsPath : undefined,
    };
  } catch (error) {
    console.error('Error reading bootstrap config:', error);
    return {};
  }
}

/**
 * Data folder: `DATA_PATH` env → bootstrap `dataPath` → `~/.anime-app/data`.
 * The out-of-checkout default makes the app boot with zero config while keeping
 * the store outside the repo.
 */
export function resolveDataPath(): string {
  return process.env.DATA_PATH || readBootstrapConfig().dataPath || path.join(appHomeDir(), 'data');
}

/**
 * Logs folder: `LOGS_PATH` env → bootstrap `logsPath` → the resolved data folder
 * (logs default to living beside the data, matching the pre-bootstrap behaviour).
 */
export function resolveLogsPath(): string {
  return process.env.LOGS_PATH || readBootstrapConfig().logsPath || resolveDataPath();
}

/**
 * Persist a data/log folder choice to the OS-config bootstrap file. Written by
 * the optional first-run wizard; nothing else writes it. Sparse — only the keys
 * passed are stored. `0600` and directory creation are best-effort.
 */
export function writeBootstrapConfig(patch: BootstrapConfig): void {
  const dir = appHomeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const merged = { ...readBootstrapConfig(), ...patch };
  const file = bootstrapConfigFile();
  fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8');
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // chmod is a best-effort no-op on Windows; ignore.
  }
}
