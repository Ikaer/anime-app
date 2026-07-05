import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { MALAuthState } from '@/models/anime';
import type { HistoricalCrawlStats } from '@/lib/anime';

interface UseConnectionsOptions {
  onDataChanged?: () => void;
}

export function useConnections(options: UseConnectionsOptions = {}) {
  const { onDataChanged } = options;
  const router = useRouter();

  // MAL auth state
  const [authState, setAuthState] = useState<MALAuthState>({ isAuthenticated: false });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBigSyncing, setIsBigSyncing] = useState(false);
  const [isHistoricalCrawling, setIsHistoricalCrawling] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [historicalStats, setHistoricalStats] = useState<HistoricalCrawlStats | null>(null);

  // SIMKL auth + sync state
  const [simklConnected, setSimklConnected] = useState(false);
  const [simklUser, setSimklUser] = useState<string | undefined>(undefined);
  const [isSimklAuthLoading, setIsSimklAuthLoading] = useState(true);
  const [simklAuthError, setSimklAuthError] = useState('');
  const [isSimklSyncing, setIsSimklSyncing] = useState(false);
  const [simklSyncMessage, setSimklSyncMessage] = useState('');

  // AniList tags sync state (public API, no auth)
  const [isAnilistTagsSyncing, setIsAnilistTagsSyncing] = useState(false);
  const [anilistTagsSyncMessage, setAnilistTagsSyncMessage] = useState('');
  const [anilistTagStats, setAnilistTagStats] = useState<{ totalAnime: number; taggedCount: number } | null>(null);

  const fetchHistoricalStats = async () => {
    try {
      const res = await fetch('/api/anime/historical-crawl');
      if (res.ok) setHistoricalStats(await res.json());
    } catch {
      // non-critical, silently ignore
    }
  };

  const fetchAnilistTagStats = async () => {
    try {
      const res = await fetch('/api/anime/anilist/tags-sync');
      if (res.ok) setAnilistTagStats(await res.json());
    } catch {
      // non-critical, silently ignore
    }
  };

  const checkAuthStatus = async () => {
    try {
      setIsAuthLoading(true);
      const response = await fetch('/api/anime/auth?action=status');
      const data = await response.json();
      setAuthState({ isAuthenticated: data.isAuthenticated, user: data.user });
    } catch (error) {
      console.error('Error checking auth status:', error);
      setAuthError('Failed to check authentication status');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const checkSimklStatus = async () => {
    try {
      setIsSimklAuthLoading(true);
      const response = await fetch('/api/anime/simkl/auth?action=status');
      const data = await response.json();
      setSimklConnected(!!data.isAuthenticated);
      setSimklUser(data.user?.user?.name);
    } catch (error) {
      console.error('Error checking SIMKL status:', error);
    } finally {
      setIsSimklAuthLoading(false);
    }
  };

  // Check auth status and historical stats on mount
  useEffect(() => {
    checkAuthStatus();
    fetchHistoricalStats();
    checkSimklStatus();
    fetchAnilistTagStats();
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    if (!router.isReady) return;

    const authParam = router.query.auth;
    if (authParam) {
      if (authParam === 'success') {
        checkAuthStatus();
      } else {
        setAuthError('Authentication failed. Please try again.');
      }
      const { auth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }

    const simklAuthParam = router.query.simkl_auth;
    if (simklAuthParam) {
      if (simklAuthParam === 'success') checkSimklStatus();
      else setSimklAuthError('SIMKL authentication failed. Please try again.');
      const { simkl_auth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.isReady, router.query, router]);

  // MAL auth handlers
  const handleConnect = async () => {
    try {
      setIsAuthLoading(true);
      setAuthError('');
      const response = await fetch('/api/anime/auth?action=login');
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        setAuthError('Failed to initiate authentication');
      }
    } catch (error) {
      console.error('Error connecting to MAL:', error);
      setAuthError('Failed to connect to MyAnimeList');
      setIsAuthLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsAuthLoading(true);
      setAuthError('');
      await fetch('/api/anime/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      setAuthState({ isAuthenticated: false });
    } catch (error) {
      console.error('Error disconnecting from MAL:', error);
      setAuthError('Failed to disconnect from MyAnimeList');
    } finally {
      setIsAuthLoading(false);
    }
  };

  // SIMKL auth handlers
  const handleSimklConnect = async () => {
    try {
      setIsSimklAuthLoading(true);
      setSimklAuthError('');
      const response = await fetch('/api/anime/simkl/auth?action=login');
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else { setSimklAuthError('Failed to initiate SIMKL authentication'); setIsSimklAuthLoading(false); }
    } catch (error) {
      console.error('Error connecting to SIMKL:', error);
      setSimklAuthError('Failed to connect to SIMKL');
      setIsSimklAuthLoading(false);
    }
  };

  const handleSimklDisconnect = async () => {
    try {
      setIsSimklAuthLoading(true);
      setSimklAuthError('');
      await fetch('/api/anime/simkl/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      setSimklConnected(false);
      setSimklUser(undefined);
    } catch (error) {
      console.error('Error disconnecting from SIMKL:', error);
      setSimklAuthError('Failed to disconnect from SIMKL');
    } finally {
      setIsSimklAuthLoading(false);
    }
  };

  const handleSimklSync = async () => {
    if (!simklConnected) return;
    setIsSimklSyncing(true);
    setSimklSyncMessage('');
    try {
      const response = await fetch('/api/anime/simkl/sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Sync failed');
      setSimklSyncMessage(
        `${data.phase}: +${data.added} updated, ${data.removed} removed${data.orphansSkipped ? `, ${data.orphansSkipped} skipped (no MAL id)` : ''}`
      );
      onDataChanged?.();
    } catch (error) {
      setSimklSyncMessage(error instanceof Error ? error.message : 'Failed to sync SIMKL.');
    } finally {
      setIsSimklSyncing(false);
    }
  };

  // Sync handlers
  const handleSync = async () => {
    if (!authState.isAuthenticated) return;
    setIsSyncing(true);
    setSyncError('');
    try {
      const response = await fetch('/api/anime/sync', { method: 'POST' });
      if (!response.ok) throw new Error('Sync failed');
      onDataChanged?.();
    } catch (error) {
      setSyncError('Failed to sync data.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBigSync = async () => {
    if (!authState.isAuthenticated) return;
    setIsBigSyncing(true);
    setSyncError('');
    try {
      const response = await fetch('/api/anime/big-sync', { method: 'POST' });
      if (!response.ok) throw new Error('Big sync failed');
      onDataChanged?.();
    } catch (error) {
      setSyncError('Failed to start big sync.');
    } finally {
      setIsBigSyncing(false);
    }
  };

  const handleHistoricalCrawl = async () => {
    if (!authState.isAuthenticated) return;
    setIsHistoricalCrawling(true);
    setSyncError('');
    try {
      const res = await fetch('/api/anime/historical-crawl', { method: 'POST' });
      if (!res.ok) throw new Error('Historical crawl failed');
      const data = await res.json();
      setHistoricalStats(data.stats);
      onDataChanged?.();
    } catch {
      setSyncError('Failed to run historical crawl.');
    } finally {
      setIsHistoricalCrawling(false);
    }
  };

  const handleAnilistTagsSync = async () => {
    setIsAnilistTagsSyncing(true);
    setAnilistTagsSyncMessage('');
    try {
      const response = await fetch('/api/anime/anilist/tags-sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AniList tags sync failed');
      setAnilistTagsSyncMessage('Sync started — see the log below for progress.');
      fetchAnilistTagStats();
    } catch (error) {
      setAnilistTagsSyncMessage(error instanceof Error ? error.message : 'Failed to start AniList tags sync.');
    } finally {
      setIsAnilistTagsSyncing(false);
    }
  };

  return {
    authState,
    isAuthLoading,
    authError,
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    isSyncing,
    isBigSyncing,
    isHistoricalCrawling,
    syncError,
    historicalStats,
    onSync: handleSync,
    onBigSync: handleBigSync,
    onHistoricalCrawl: handleHistoricalCrawl,
    simklConnected,
    simklUser,
    isSimklAuthLoading,
    simklAuthError,
    isSimklSyncing,
    simklSyncMessage,
    onSimklConnect: handleSimklConnect,
    onSimklDisconnect: handleSimklDisconnect,
    onSimklSync: handleSimklSync,
    isAnilistTagsSyncing,
    anilistTagsSyncMessage,
    anilistTagStats,
    onAnilistTagsSync: handleAnilistTagsSync,
  };
}
