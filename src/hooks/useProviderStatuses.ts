import { useCallback, useEffect, useState } from 'react';
import type { ProvenanceSource } from '@/models/anime';
import type { ProviderStatus } from '@/lib/providerStatus';

/**
 * The one client-side reader of `/api/anime/providers`
 * (docs/PROVIDER-PARITY.md E1–E4). Both consumers — the header badges and the
 * connections page — go through it, so "how do I ask whether a provider is
 * connected?" has a single answer. It used to have four: three bespoke badge
 * components with a fetch each, plus `useConnections`.
 *
 * `import type` only: `providerStatus.ts` is server-only (it reads the auth
 * files and the personal slices) and the type is erased at compile time.
 */
export function useProviderStatuses() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [precedence, setPrecedence] = useState<ProvenanceSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/providers');
      if (!res.ok) return;
      const data = await res.json();
      setProviders(data.providers ?? []);
      setPrecedence(data.precedence ?? []);
    } catch {
      // Non-critical: the page still renders every provider's capabilities from
      // the descriptor, just without live connection status.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byId = providers.reduce<Partial<Record<ProvenanceSource, ProviderStatus>>>(
    (acc, p) => {
      acc[p.id] = p;
      return acc;
    },
    {}
  );

  return { providers, byId, precedence, isLoading, refresh };
}
