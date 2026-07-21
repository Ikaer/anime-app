/**
 * **One status row per provider** — capability (declarative) + connection
 * (runtime) + how much data the provider actually holds, assembled once so every
 * surface that draws a provider reads the same shape
 * (docs/PROVIDER-PARITY.md E1–E4).
 *
 * Before this, "is X connected?" was answered by three bespoke auth endpoints
 * with three different payload shapes (`user.name` / `user.user.name` /
 * `user.name` + `isConfigured`), and the header badges re-derived it a fourth
 * time — three near-identical components, one fetch each. `local` was in none of
 * them, which is E3: on a keyless install the only *active* personal provider was
 * the one with no UI at all.
 *
 * Server-only: composes [providers.ts](providers.ts) (auth files) with the
 * personal slices in [store.ts](store.ts). Client components may `import type`
 * from here — the type is erased — but never import it as a value.
 *
 * Deliberately NOT a sync-orchestration layer: this reports identity, capability
 * and status, exactly the three uniform things §3 scopes the descriptor to. Each
 * provider's sync stays its own explicit operation.
 */

import type { ProvenanceSource } from '@/models/anime';
import {
  PROVIDER_CAPABILITIES,
  PROVIDER_IDS,
  type CatalogCapability,
  type PersonalCapability,
} from '@/lib/providers/capabilities';
import { getMALAuthData, isMALTokenValid } from '@/lib/providers/mal/client';
import { getSimklAuthData, isSimklTokenValid } from '@/lib/providers/simkl/client';
import { getAnilistAuthData, isAnilistTokenValid } from '@/lib/providers/anilist/auth';
import {
  getMalClientId,
  getSimklClientId,
  getAnilistClientId,
} from '@/lib/settings';
import {
  isPersonalProviderEnabled,
  getResolvedPersonalPrecedence,
} from '@/lib/providers/registry';
import {
  getAllMalPersonal,
  getAllSimklEntries,
  getAllAnilistPersonalEntries,
  getAllLocalEntries,
} from '@/lib/store';

export interface ProviderStatus {
  id: ProvenanceSource;
  label: string;
  iconSrc?: string;
  shortLabel: string;
  catalog?: CatalogCapability;
  personal?: PersonalCapability;
  /**
   * Is an account linked? Token **presence**, deliberately the same predicate
   * enablement uses (see `providers.ts`) rather than the stricter validity check
   * the old MAL badge did — a lapsed token still means "this is a MAL user", and
   * a badge that silently reads "not connected" is how an expired token gets
   * mistaken for a disconnected one. `local` is always true: there is nothing to
   * link. Validity is reported separately below rather than folded in.
   */
  connected: boolean;
  /** Token present AND usable. `connected && !tokenValid` = re-authenticate. */
  tokenValid: boolean;
  /** OAuth client credentials present — false means connecting cannot work yet. */
  configured: boolean;
  /** Does this provider's personal role participate right now? */
  enabled: boolean;
  userName?: string;
  /** Rows in this provider's personal slice. 0 for a catalog-only provider. */
  entryCount: number;
  /** Position in the resolved personal precedence; -1 when not participating. */
  precedenceRank: number;
}

export interface ProviderStatusResponse {
  providers: ProviderStatus[];
  /** The resolved personal precedence — the order a conflict is settled in. */
  precedence: ProvenanceSource[];
}

/** Per-provider auth facts, in each service's own shape. The one place they differ. */
function readAuth(id: ProvenanceSource): {
  connected: boolean;
  tokenValid: boolean;
  configured: boolean;
  userName?: string;
} {
  switch (id) {
    case 'mal': {
      const { user, token } = getMALAuthData();
      return {
        connected: token != null,
        tokenValid: isMALTokenValid(token),
        configured: !!getMalClientId(),
        userName: user?.name,
      };
    }
    case 'simkl': {
      const { user, token } = getSimklAuthData();
      return {
        connected: token != null,
        tokenValid: isSimklTokenValid(token),
        configured: !!getSimklClientId(),
        userName: user?.user?.name,
      };
    }
    case 'anilist': {
      const { user, token } = getAnilistAuthData();
      return {
        connected: token != null,
        tokenValid: isAnilistTokenValid(token),
        configured: !!getAnilistClientId(),
        userName: user?.name,
      };
    }
    default:
      // `local` and any future in-app provider: no service, so nothing to link
      // and nothing to configure. Marked connected so the UI's "not applicable"
      // slot is a stated fact rather than a permanent red dot.
      return { connected: true, tokenValid: true, configured: true };
  }
}

/** Rows in a provider's personal slice — what it is actually holding for you. */
function readEntryCount(id: ProvenanceSource): number {
  if (PROVIDER_CAPABILITIES[id].personal === undefined) return 0;
  switch (id) {
    case 'mal': return Object.keys(getAllMalPersonal()).length;
    case 'simkl': return Object.keys(getAllSimklEntries()).length;
    case 'anilist': return Object.keys(getAllAnilistPersonalEntries()).length;
    case 'local': return Object.keys(getAllLocalEntries()).length;
    default: return 0;
  }
}

export function getProviderStatuses(): ProviderStatusResponse {
  const precedence = getResolvedPersonalPrecedence();

  const providers = PROVIDER_IDS.map<ProviderStatus>(id => {
    const caps = PROVIDER_CAPABILITIES[id];
    const auth = readAuth(id);
    return {
      id,
      label: caps.label,
      iconSrc: caps.iconSrc,
      shortLabel: caps.shortLabel,
      catalog: caps.catalog,
      personal: caps.personal,
      ...auth,
      // An external provider is enabled by its token; `local` by the settings.
      // Asked of the single predicate, never re-derived here.
      enabled: caps.personal !== undefined && isPersonalProviderEnabled(id),
      entryCount: readEntryCount(id),
      precedenceRank: precedence.indexOf(id),
    };
  });

  return { providers, precedence };
}
