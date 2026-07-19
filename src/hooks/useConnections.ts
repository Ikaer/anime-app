import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { MALAuthState } from '@/models/anime';
import type { HistoricalCrawlStats } from '@/lib/malSync';
import type { AniListPersonalImportResult } from '@/lib/anilistPersonalSync';
import type { AniListPushStats } from '@/lib/anilistPush';

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
  const [isAnilistMetaSyncing, setIsAnilistMetaSyncing] = useState(false);
  const [anilistMetaSyncMessage, setAnilistMetaSyncMessage] = useState('');
  const [anilistMetaStats, setAnilistMetaStats] = useState<{ totalAnime: number; taggedCount: number } | null>(null);

  // AniList catalog crawl state (docs/PROVIDER-FREE.md Phase 3, public API, no auth)
  const [isAnilistCatalogCrawling, setIsAnilistCatalogCrawling] = useState(false);
  const [anilistCatalogCrawlMessage, setAnilistCatalogCrawlMessage] = useState('');
  const [anilistCatalogStats, setAnilistCatalogStats] = useState<{ totalCanonicalIds: number; anilistOnlyIds: number } | null>(null);

  // AniList OAuth state (docs/ANILIST-OAUTH.md) — the login tier above the
  // anonymous by-username import below; unlocks private reads + write-back.
  const [anilistConnected, setAnilistConnected] = useState(false);
  const [anilistUser, setAnilistUser] = useState<string | undefined>(undefined);
  const [anilistConfigured, setAnilistConfigured] = useState(false);
  const [isAnilistAuthLoading, setIsAnilistAuthLoading] = useState(true);
  const [anilistAuthError, setAnilistAuthError] = useState('');

  // AniList personal-list import state (docs/PROVIDER-FREE.md P3b, anonymous by username)
  const [isAnilistImporting, setIsAnilistImporting] = useState(false);
  const [anilistImportResult, setAnilistImportResult] = useState<AniListPersonalImportResult | null>(null);
  const [anilistImportUsername, setAnilistImportUsername] = useState<string | undefined>(undefined);
  const [anilistImportStoredCount, setAnilistImportStoredCount] = useState<number | null>(null);
  const [anilistPushStats, setAnilistPushStats] = useState<AniListPushStats | null>(null);

  const fetchHistoricalStats = async () => {
    try {
      const res = await fetch('/api/anime/mal/historical-crawl');
      if (res.ok) setHistoricalStats(await res.json());
    } catch {
      // non-critical, silently ignore
    }
  };

  const fetchAnilistMetaStats = async () => {
    try {
      const res = await fetch('/api/anime/anilist/meta-sync');
      if (res.ok) setAnilistMetaStats(await res.json());
    } catch {
      // non-critical, silently ignore
    }
  };

  const fetchAnilistCatalogStats = async () => {
    try {
      const res = await fetch('/api/anime/anilist/catalog-crawl');
      if (res.ok) setAnilistCatalogStats(await res.json());
    } catch {
      // non-critical, silently ignore
    }
  };

  const fetchAnilistImportConfig = async () => {
    try {
      const res = await fetch('/api/anime/anilist/personal-import');
      if (res.ok) {
        const data = await res.json();
        setAnilistImportUsername(data.username || undefined);
        setAnilistImportStoredCount(typeof data.storedCount === 'number' ? data.storedCount : null);
      }
    } catch {
      // non-critical, silently ignore
    }
  };

  // Deliberately NOT fetched on mount: the stats endpoint reads the whole
  // AniList list to diff against, so it costs a GraphQL request. Gated on an
  // actual connection by the effect below.
  const fetchAnilistPushStats = async () => {
    try {
      const res = await fetch('/api/anime/anilist/personal-push');
      if (res.ok) setAnilistPushStats(await res.json());
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

  const checkAnilistStatus = async () => {
    try {
      setIsAnilistAuthLoading(true);
      const response = await fetch('/api/anime/anilist/auth?action=status');
      const data = await response.json();
      setAnilistConnected(!!data.isAuthenticated);
      setAnilistUser(data.user?.name);
      setAnilistConfigured(!!data.isConfigured);
    } catch (error) {
      console.error('Error checking AniList status:', error);
    } finally {
      setIsAnilistAuthLoading(false);
    }
  };

  // Check auth status and historical stats on mount
  useEffect(() => {
    checkAuthStatus();
    fetchHistoricalStats();
    checkSimklStatus();
    checkAnilistStatus();
    fetchAnilistMetaStats();
    fetchAnilistCatalogStats();
    fetchAnilistImportConfig();
  }, []);

  // Push drift is only computable — and only meaningful — once AniList is
  // connected, so this waits for the auth check rather than running on mount.
  useEffect(() => {
    if (!anilistConnected) {
      setAnilistPushStats(null);
      return;
    }
    fetchAnilistPushStats();
  }, [anilistConnected]);

  // While a push runs, poll for progress. The endpoint answers from in-memory
  // counters in this state (no remote read), so a 5s poll is cheap; the final
  // poll after it stops re-diffs and lands on the real "in sync" number.
  useEffect(() => {
    if (!anilistPushStats?.pushRunning) return;
    const timer = setTimeout(() => { void fetchAnilistPushStats(); }, 5000);
    return () => clearTimeout(timer);
  }, [anilistPushStats]);

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

    const anilistAuthParam = router.query.anilist_auth;
    if (anilistAuthParam) {
      if (anilistAuthParam === 'success') checkAnilistStatus();
      else setAnilistAuthError('AniList authentication failed. Please try again.');
      const { anilist_auth, ...rest } = router.query;
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

  // AniList auth handlers
  const handleAnilistConnect = async () => {
    try {
      setIsAnilistAuthLoading(true);
      setAnilistAuthError('');
      const response = await fetch('/api/anime/anilist/auth?action=login');
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else { setAnilistAuthError(data.error || 'Failed to initiate AniList authentication'); setIsAnilistAuthLoading(false); }
    } catch (error) {
      console.error('Error connecting to AniList:', error);
      setAnilistAuthError('Failed to connect to AniList');
      setIsAnilistAuthLoading(false);
    }
  };

  const handleAnilistDisconnect = async () => {
    try {
      setIsAnilistAuthLoading(true);
      setAnilistAuthError('');
      await fetch('/api/anime/anilist/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      setAnilistConnected(false);
      setAnilistUser(undefined);
    } catch (error) {
      console.error('Error disconnecting from AniList:', error);
      setAnilistAuthError('Failed to disconnect from AniList');
    } finally {
      setIsAnilistAuthLoading(false);
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
      const response = await fetch('/api/anime/mal/sync', { method: 'POST' });
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
      const response = await fetch('/api/anime/mal/big-sync', { method: 'POST' });
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
      const res = await fetch('/api/anime/mal/historical-crawl', { method: 'POST' });
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

  const handleAnilistMetaSync = async () => {
    setIsAnilistMetaSyncing(true);
    setAnilistMetaSyncMessage('');
    try {
      const response = await fetch('/api/anime/anilist/meta-sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AniList tags sync failed');
      setAnilistMetaSyncMessage('Sync started — see the log below for progress.');
      fetchAnilistMetaStats();
    } catch (error) {
      setAnilistMetaSyncMessage(error instanceof Error ? error.message : 'Failed to start AniList tags sync.');
    } finally {
      setIsAnilistMetaSyncing(false);
    }
  };

  const handleAnilistCatalogCrawl = async () => {
    setIsAnilistCatalogCrawling(true);
    setAnilistCatalogCrawlMessage('');
    try {
      const response = await fetch('/api/anime/anilist/catalog-crawl', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AniList catalog crawl failed');
      setAnilistCatalogCrawlMessage('Crawl started — see the log below for progress.');
      fetchAnilistCatalogStats();
    } catch (error) {
      setAnilistCatalogCrawlMessage(error instanceof Error ? error.message : 'Failed to start AniList catalog crawl.');
    } finally {
      setIsAnilistCatalogCrawling(false);
    }
  };

  const handleAnilistPersonalImport = async (username: string) => {
    const u = username.trim();
    if (!u) return;
    setIsAnilistImporting(true);
    setAnilistImportResult(null);
    try {
      const response = await fetch('/api/anime/anilist/personal-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u }),
      });
      const data: AniListPersonalImportResult = await response.json();
      setAnilistImportResult(data);
      if (data.ok) {
        setAnilistImportUsername(u);
        fetchAnilistImportConfig();
        onDataChanged?.();
      }
    } catch {
      setAnilistImportResult({ ok: false, imported: 0, skippedNoMal: 0, errorKind: 'network', error: 'Network error' });
    } finally {
      setIsAnilistImporting(false);
    }
  };

  const handleAnilistPush = async () => {
    try {
      await fetch('/api/anime/anilist/personal-push', { method: 'POST' });
      // The POST is fire-and-forget; this first refetch flips `pushRunning`,
      // which starts the poll below.
      await fetchAnilistPushStats();
    } catch {
      // Non-fatal: the sweep may well have started. The poll will pick it up.
    }
  };

  // One group per source. The nesting is what carries the "which source?"
  // information — no field inside a group needs its source as a prefix.
  return {
    mal: {
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
    },
    simkl: {
      isConnected: simklConnected,
      userName: simklUser,
      isAuthLoading: isSimklAuthLoading,
      authError: simklAuthError,
      isSyncing: isSimklSyncing,
      syncMessage: simklSyncMessage,
      onConnect: handleSimklConnect,
      onDisconnect: handleSimklDisconnect,
      onSync: handleSimklSync,
    },
    anilist: {
      isConnected: anilistConnected,
      userName: anilistUser,
      isConfigured: anilistConfigured,
      isAuthLoading: isAnilistAuthLoading,
      authError: anilistAuthError,
      onConnect: handleAnilistConnect,
      onDisconnect: handleAnilistDisconnect,
      isSyncing: isAnilistMetaSyncing,
      syncMessage: anilistMetaSyncMessage,
      tagStats: anilistMetaStats,
      onSync: handleAnilistMetaSync,
      isCatalogCrawling: isAnilistCatalogCrawling,
      catalogCrawlMessage: anilistCatalogCrawlMessage,
      catalogStats: anilistCatalogStats,
      onCatalogCrawl: handleAnilistCatalogCrawl,
      isImporting: isAnilistImporting,
      importResult: anilistImportResult,
      importUsername: anilistImportUsername,
      importStoredCount: anilistImportStoredCount,
      onPersonalImport: handleAnilistPersonalImport,
      pushStats: anilistPushStats,
      onPush: handleAnilistPush,
    },
  };
}
