import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ConnectionStatusBadge from './ConnectionStatusBadge';

const SimklConnectionBadge: React.FC = () => {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [userName, setUserName] = useState<string | undefined>(undefined);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/simkl/auth?action=status');
      const data = await res.json();
      setConnected(!!data.isAuthenticated);
      setUserName(data.user?.user?.name);
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
      iconSrc="/simkl.png"
      alt="SIMKL"
      connected={connected}
      title={connected ? `SIMKL : connecté${userName ? ` (${userName})` : ''}` : 'SIMKL : non connecté'}
    />
  );
};

export default SimklConnectionBadge;
