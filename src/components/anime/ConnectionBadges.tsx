import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import { useProviderStatuses } from '@/hooks';
import { providersWithRole } from '@/lib/providers/capabilities';
import { useT } from '@/lib/i18n';

/**
 * The header's provider badges (docs/PROVIDER-PARITY.md E2). One component over
 * one fetch, rendering a badge per personal-list provider from the descriptor —
 * replacing `MalConnectionBadge` / `SimklConnectionBadge` /
 * `AnilistConnectionBadge`, three near-identical stateful wrappers that each hit
 * their own auth endpoint and each had to be edited when a provider was added.
 * `ConnectionStatusBadge` (the presenter) was already shared; the duplication was
 * entirely in the state.
 *
 * **`local` gets a badge too, when it is on** (E3): on a keyless install it is
 * the only active personal provider, and it previously had no presence anywhere
 * in the UI. Off, it is simply not a connection, so it is not listed.
 */
const ConnectionBadges: React.FC = () => {
  const router = useRouter();
  const t = useT();
  const { byId, refresh } = useProviderStatuses();

  // Re-check on navigation: an OAuth callback lands on a route change.
  useEffect(() => {
    const onRouteChange = () => { void refresh(); };
    router.events.on('routeChangeComplete', onRouteChange);
    return () => router.events.off('routeChangeComplete', onRouteChange);
  }, [refresh, router.events]);

  return (
    <>
      {providersWithRole('personal').map(id => {
        const status = byId[id];
        if (!status) return null;
        // A provider with no account (`local`) is a badge only while active —
        // "connected" is meaningless for it, "in use" is not.
        const isLocal = status.personal?.auth === 'none';
        if (isLocal && !status.enabled) return null;

        const stale = status.connected && !status.tokenValid;
        const title = isLocal
          ? t('badge.localActive')
          : stale
            ? t('badge.expired', { provider: status.label })
            : status.connected
              ? (status.userName
                ? t('badge.connectedAs', { provider: status.label, name: status.userName })
                : t('badge.connected', { provider: status.label }))
              : t('badge.notConnected', { provider: status.label });

        return (
          <ConnectionStatusBadge
            key={id}
            iconSrc={status.iconSrc}
            label={status.iconSrc ? undefined : status.shortLabel}
            alt={status.label}
            connected={isLocal ? status.enabled : status.connected}
            stale={stale}
            title={title}
          />
        );
      })}
    </>
  );
};

export default ConnectionBadges;
