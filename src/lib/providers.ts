/**
 * Provider-capability helpers (docs/localRating/).
 *
 * The single predicate that ties local-provider enablement + precedence together:
 * **"is a writable external personal provider connected?"** — kept here, in its
 * own module, rather than in `settings.ts` because it must read the MAL/SIMKL
 * auth files, and `simkl.ts` already imports `settings.ts` (importing them back
 * would be a cycle). The pure precedence math lives in `animeUtils.ts`
 * (`resolveLocalPrecedence`); this module supplies it the auth-derived facts.
 *
 * Server-only (reads auth JSON via mal/simkl).
 */

import type { ProvenanceSource } from '@/models/anime';
import { getMALAuthData } from '@/lib/mal';
import { getSimklAuthData } from '@/lib/simkl';
import { getAnilistAuthData } from '@/lib/anilistAuth';
import {
  DEFAULT_PERSONAL_PRECEDENCE,
  resolveLocalPrecedence,
} from '@/lib/animeUtils';
import { getLocalPrecedenceMode, getLocalProviderEnabledMode } from '@/lib/settings';

/**
 * Is a writable external personal provider connected? Uses token **presence**,
 * not validity (an expired-but-refreshable MAL token still means "this is a MAL
 * user"): the whole point is to classify the deployment so phase 2 knows whether
 * to route writes to local, and a token lapsing mid-refresh must not flip that.
 * Extended per registered writer — AniList joined at OAuth (docs/ANILIST-OAUTH.md).
 */
export function hasWritableExternal(): boolean {
  return (
    getMALAuthData().token != null ||
    getSimklAuthData().token != null ||
    getAnilistAuthData().token != null
  );
}

/**
 * Is the local provider active? `on`/`off` are explicit; `auto` = on iff no
 * writable external provider (so an existing MAL/SIMKL user has local OFF and
 * today's write path is preserved — purely additive).
 */
export function isLocalProviderEnabled(): boolean {
  const mode = getLocalProviderEnabledMode();
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return !hasWritableExternal();
}

/**
 * The personal-state precedence actually in force: the default SIMKL > MAL >
 * AniList order, with `local` inserted (top/bottom) only when the local provider
 * is enabled. When disabled, `local` is absent entirely so a stray
 * `animes_local_personal.json` entry is never consulted. This is what
 * `store.ts` threads into `toAnimeRecord` (and folds into its row-cache key).
 */
export function getResolvedPersonalPrecedence(): ProvenanceSource[] {
  if (!isLocalProviderEnabled()) return DEFAULT_PERSONAL_PRECEDENCE;
  return resolveLocalPrecedence(getLocalPrecedenceMode(), DEFAULT_PERSONAL_PRECEDENCE, {
    hasWritableExternal: hasWritableExternal(),
  });
}
