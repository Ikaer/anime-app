/**
 * Provider **status** — the runtime half of provider identity: "is this provider
 * connected / enabled right now?". The declarative half — what each provider is
 * and what it can do — is [providerCapabilities.ts](providerCapabilities.ts),
 * which is client-safe. Every question of the form "who can do X?" is answered
 * by composing the two here, in ONE place (docs/PROVIDER-PARITY.md D2).
 *
 * Before D2 this module hand-read three auth files and the writer registry
 * repeated the same per-provider check for its own provider, with the two kept
 * in agreement by hand. Now `isPersonalProviderEnabled` is the single
 * enablement predicate: `personalWriters.ts` calls it instead of carrying an
 * `isEnabled` per writer, so a registered writer cannot disagree with
 * `hasWritableExternal` about whether its provider is on.
 *
 * Kept in its own module rather than in `settings.ts` because it must read the
 * MAL/SIMKL auth files, and `simkl.ts` already imports `settings.ts` (importing
 * them back would be a cycle). The pure precedence math lives in `animeUtils.ts`
 * (`resolveLocalPrecedence`); this module supplies it the auth-derived facts.
 *
 * Server-only (reads auth JSON via mal/simkl/anilistAuth).
 */

import type { ProvenanceSource } from '@/models/anime';
import { getMALAuthData } from '@/lib/providers/mal/client';
import { getSimklAuthData } from '@/lib/providers/simkl/client';
import { getAnilistAuthData } from '@/lib/providers/anilist/auth';
import {
  DEFAULT_PERSONAL_PRECEDENCE,
  resolveLocalPrecedence,
} from '@/lib/animeUtils';
import { getLocalPrecedenceMode, getLocalProviderEnabledMode } from '@/lib/settings';
import {
  PROVIDER_IDS,
  isExternalPersonalProvider,
  isWritableProvider,
  supportsStatusClear,
} from '@/lib/providers/capabilities';

/**
 * Token **presence** per external provider — the one place an auth file is read
 * for the purpose of enablement. Presence, not validity: an
 * expired-but-refreshable MAL token still means "this is a MAL user", and the
 * point is to classify the *deployment* (does it route writes to local?), which
 * a token lapsing mid-refresh must not flip.
 *
 * Only external providers appear; `local` has no token, and asking about it goes
 * through `isPersonalProviderEnabled`.
 */
const TOKEN_READERS: Partial<Record<ProvenanceSource, () => boolean>> = {
  mal: () => getMALAuthData().token != null,
  simkl: () => getSimklAuthData().token != null,
  anilist: () => getAnilistAuthData().token != null,
};

/** Is this external provider's account connected (token present)? */
export function isProviderConnected(id: ProvenanceSource): boolean {
  return TOKEN_READERS[id]?.() ?? false;
}

/**
 * **The** enablement predicate for a personal provider: an external one is
 * enabled when its account is connected; `local` when the settings say so.
 * `personalWriters.ts` filters its registry on exactly this, so there is no
 * second definition to drift.
 */
export function isPersonalProviderEnabled(id: ProvenanceSource): boolean {
  if (isExternalPersonalProvider(id)) return isProviderConnected(id);
  if (id === 'local') return isLocalProviderEnabled();
  return false;
}

/**
 * Is a writable external personal provider connected? A query over declared
 * capability now, not a hand-maintained list of three auth files: a provider
 * joins by gaining a `personal.write` entry in the descriptor, and adding one
 * to the writer registry without a descriptor row is a compile error.
 */
export function hasWritableExternal(): boolean {
  return PROVIDER_IDS.some(
    id => isExternalPersonalProvider(id) && isWritableProvider(id) && isProviderConnected(id)
  );
}

/**
 * May the UI offer "clear status"? Only when every enabled personal provider can
 * actually express it — i.e. today, when `local` is the only one on. Previously
 * spelled `!hasWritableExternal()`, which was the same answer derived from the
 * wrong question: it assumed no external provider could ever clear a status
 * rather than reading whether they declare it.
 */
export function canClearStatus(): boolean {
  return PROVIDER_IDS.filter(isPersonalProviderEnabled).every(supportsStatusClear);
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
 * `personal/local.json` entry is never consulted. This is what
 * `store.ts` threads into `toAnimeRecord` (and folds into its row-cache key).
 */
export function getResolvedPersonalPrecedence(): ProvenanceSource[] {
  if (!isLocalProviderEnabled()) return DEFAULT_PERSONAL_PRECEDENCE;
  return resolveLocalPrecedence(getLocalPrecedenceMode(), DEFAULT_PERSONAL_PRECEDENCE, {
    hasWritableExternal: hasWritableExternal(),
  });
}
