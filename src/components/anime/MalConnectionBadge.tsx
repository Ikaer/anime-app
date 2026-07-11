import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ConnectionStatusBadge from './ConnectionStatusBadge';
import { useT } from '@/lib/i18n';

const MalConnectionBadge: React.FC = () => {
  const router = useRouter();
  const t = useT();
  const [connected, setConnected] = useState(false);
  const [userName, setUserName] = useState<string | undefined>(undefined);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/auth?action=status');
      const data = await res.json();
      setConnected(!!data.isAuthenticated);
      setUserName(data.user?.name);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    router.events.on('routeChangeComplete', checkStatus);
    return () => router.events.off('routeChangeComplete', checkStatus);
  }, [checkStatus, router.events]);

  return (
    <ConnectionStatusBadge
      iconSrc="/mal.png"
      alt="MyAnimeList"
      connected={connected}
      title={connected
        ? (userName
          ? t('badge.connectedAs', { provider: 'MyAnimeList', name: userName })
          : t('badge.connected', { provider: 'MyAnimeList' }))
        : t('badge.notConnected', { provider: 'MyAnimeList' })}
    />
  );
};

export default MalConnectionBadge;
