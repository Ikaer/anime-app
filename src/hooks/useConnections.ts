import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import type { HistoricalCrawlStats } from '@/lib/providers/mal/sync';
import type { AniListPersonalImportResult } from '@/lib/providers/anilist/personalSync';
import type { AniListPushStats } from '@/lib/providers/anilist/push';
import { useProviderStatuses } from './useProviderStatuses';

interface UseConnectionsOptions {
  onDataChanged?: () => void;
}

/**
 * Connections-page state (docs/PROVIDER-PARITY.md E1–E4).
 *
 * **Connection status is no longer part of it.** It comes from
 * `useProviderStatuses` — one `/api/anime/providers` read covering every
 * provider, including `local`, in one shape — where this hook used to carry
 * three independent status checks answering three different payload shapes.
 * What is left here is what genuinely differs per provider: the OAuth
 * redirect/logout calls and the sync actions.
 *
 * The sync error is split by **role** rather than kept as one MAL-wide string:
 * a list-sync failure and a catalog-crawl failure now render on their own cards,
 * which is the same split the page itself is organized on (E4).
 */
export function useConnections(options: UseConnectionsOptions = {}) {
  const { onDataChanged } = options;
  const router = useRouter();

  const { byId, precedence, isLoading: isStatusLoading, refresh: refreshStatuses } = useProviderStatuses();

  const [authError, setAuthError] = useState('');
  const [simklAuthError, setSimklAuthError] = useState('');
  const [anilistAuthError, setAnilistAuthError] = useState('');

  // MAL sync state, split by role.
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBigSyncing, setIsBigSyncing] = useState(false);
  const [isHistoricalCrawling, setIsHistoricalCrawling] = useState(false);
  const [listSyncError, setListSyncError] = useState('');
  const [catalogSyncError, setCatalogSyncError] = useState('');
  const [historicalStats, setHistoricalStats] = useState<HistoricalCrawlStats | null>(null);

  // SIMKL sync state
  const [isSimklSyncing, setIsSimklSyncing] = useState(false);
  const [simklSyncMessage, setSimklSyncMessage] = useState('');

  // AniList catalog-role state (public API, no auth)
  const [isAnilistMetaSyncing, setIsAnilistMetaSyncing] = useState(false);
  const [anilistMetaSyncMessage, setAnilistMetaSyncMessage] = useState('');
  const [anilistMetaStats, setAnilistMetaStats] = useState<{ totalAnime: number; taggedCount: number } | null>(null);
  const [isAnilistCatalogCrawling, setIsAnilistCatalogCrawling] = useState(false);
  const [anilistCatalogCrawlMessage, setAnilistCatalogCrawlMessage] = useState('');
  const [anilistCatalogStats, setAnilistCatalogStats] = useState<{ totalCanonicalIds: number; anilistOnlyIds: number } | null>(null);

  // AniList personal-role state (the OAuth'd viewer's own list)
  const [isAnilistImporting, setIsAnilistImporting] = useState(false);
  const [anilistImportResult, setAnilistImportResult] = useState<AniListPersonalImportResult | null>(null);
  const [anilistImportStoredCount, setAnilistImportStoredCount] = useState<number | null>(null);
  const [anilistPushStats, setAnilistPushStats] = useState<AniListPushStats | null>(null);

  const malConnected = !!byId.mal?.connected;
  const simklConnected = !!byId.simkl?.connected;
  const anilistConnected = !!byId.anilist?.connected;

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

  useEffect(() => {
    fetchHistoricalStats();
    fetchAnilistMetaStats();
    fetchAnilistCatalogStats();
    fetchAnilistImportConfig();
  }, []);

  // Push drift is only computable — and only meaningful — once AniList is
  // connected, so this waits for the status read rather than running on mount.
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

  // Handle OAuth callbacks. Every provider's callback lands the same way — a
  // query param this strips — and every one re-reads the single status endpoint.
  useEffect(() => {
    if (!router.isReady) return;

    const strip = (key: string) => {
      const { [key]: _removed, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    };

    const authParam = router.query.auth;
    if (authParam) {
      if (authParam === 'success') void refreshStatuses();
      else setAuthError('Authentication failed. Please try again.');
      strip('auth');
    }

    const simklAuthParam = router.query.simkl_auth;
    if (simklAuthParam) {
      if (simklAuthParam === 'success') void refreshStatuses();
      else setSimklAuthError('SIMKL authentication failed. Please try again.');
      strip('simkl_auth');
    }

    const anilistAuthParam = router.query.anilist_auth;
    if (anilistAuthParam) {
      if (anilistAuthParam === 'success') void refreshStatuses();
      else setAnilistAuthError('AniList authentication failed. Please try again.');
      strip('anilist_auth');
    }
  }, [router.isReady, router.query, router, refreshStatuses]);

  // ── Auth handlers. One per provider because the endpoints differ. ──
  const handleConnect = async () => {
    try {
      setAuthError('');
      const response = await fetch('/api/anime/auth?action=login');
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else setAuthError('Failed to initiate authentication');
    } catch (error) {
      console.error('Error connecting to MAL:', error);
      setAuthError('Failed to connect to MyAnimeList');
    }
  };

  const handleDisconnect = async () => {
    try {
      setAuthError('');
      await fetch('/api/anime/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      await refreshStatuses();
    } catch (error) {
      console.error('Error disconnecting from MAL:', error);
      setAuthError('Failed to disconnect from MyAnimeList');
    }
  };

  const handleSimklConnect = async () => {
    try {
      setSimklAuthError('');
      const response = await fetch('/api/anime/simkl/auth?action=login');
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else setSimklAuthError('Failed to initiate SIMKL authentication');
    } catch (error) {
      console.error('Error connecting to SIMKL:', error);
      setSimklAuthError('Failed to connect to SIMKL');
    }
  };

  const handleSimklDisconnect = async () => {
    try {
      setSimklAuthError('');
      await fetch('/api/anime/simkl/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      await refreshStatuses();
    } catch (error) {
      console.error('Error disconnecting from SIMKL:', error);
      setSimklAuthError('Failed to disconnect from SIMKL');
    }
  };

  const handleAnilistConnect = async () => {
    try {
      setAnilistAuthError('');
      const response = await fetch('/api/anime/anilist/auth?action=login');
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else setAnilistAuthError(data.error || 'Failed to initiate AniList authentication');
    } catch (error) {
      console.error('Error connecting to AniList:', error);
      setAnilistAuthError('Failed to connect to AniList');
    }
  };

  const handleAnilistDisconnect = async () => {
    try {
      setAnilistAuthError('');
      await fetch('/api/anime/anilist/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      await refreshStatuses();
    } catch (error) {
      console.error('Error disconnecting from AniList:', error);
      setAnilistAuthError('Failed to disconnect from AniList');
    }
  };

  // ── Sync handlers ──
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
      void refreshStatuses();
    } catch (error) {
      setSimklSyncMessage(error instanceof Error ? error.message : 'Failed to sync SIMKL.');
    } finally {
      setIsSimklSyncing(false);
    }
  };

  const handleSync = async () => {
    if (!malConnected) return;
    setIsSyncing(true);
    setListSyncError('');
    try {
      const response = await fetch('/api/anime/mal/sync', { method: 'POST' });
      if (!response.ok) throw new Error('Sync failed');
      onDataChanged?.();
      void refreshStatuses();
    } catch (error) {
      setListSyncError('Failed to sync data.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBigSync = async () => {
    if (!malConnected) return;
    setIsBigSyncing(true);
    setCatalogSyncError('');
    try {
      const response = await fetch('/api/anime/mal/big-sync', { method: 'POST' });
      if (!response.ok) throw new Error('Big sync failed');
      onDataChanged?.();
    } catch (error) {
      setCatalogSyncError('Failed to start big sync.');
    } finally {
      setIsBigSyncing(false);
    }
  };

  const handleHistoricalCrawl = async () => {
    if (!malConnected) return;
    setIsHistoricalCrawling(true);
    setCatalogSyncError('');
    try {
      const res = await fetch('/api/anime/mal/historical-crawl', { method: 'POST' });
      if (!res.ok) throw new Error('Historical crawl failed');
      const data = await res.json();
      setHistoricalStats(data.stats);
      onDataChanged?.();
    } catch {
      setCatalogSyncError('Failed to run historical crawl.');
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

  const handleAnilistPersonalImport = async () => {
    setIsAnilistImporting(true);
    setAnilistImportResult(null);
    try {
      const response = await fetch('/api/anime/anilist/personal-import', { method: 'POST' });
      const data: AniListPersonalImportResult = await response.json();
      setAnilistImportResult(data);
      if (data.ok) {
        fetchAnilistImportConfig();
        onDataChanged?.();
        void refreshStatuses();
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

  const anyBusy = isSyncing || isBigSyncing || isHistoricalCrawling
    || isAnilistMetaSyncing || isAnilistCatalogCrawling || isAnilistImporting || isSimklSyncing;

  // Status (uniform, per provider) is kept separate from actions (per provider,
  // genuinely different) — the same split the descriptor makes.
  return {
    statuses: byId,
    precedence,
    isStatusLoading,
    anyBusy,
    refreshStatuses,
    mal: {
      authError,
      onConnect: handleConnect,
      onDisconnect: handleDisconnect,
      isSyncing,
      isBigSyncing,
      isHistoricalCrawling,
      listSyncError,
      catalogSyncError,
      historicalStats,
      onSync: handleSync,
      onBigSync: handleBigSync,
      onHistoricalCrawl: handleHistoricalCrawl,
    },
    simkl: {
      authError: simklAuthError,
      isSyncing: isSimklSyncing,
      syncMessage: simklSyncMessage,
      onConnect: handleSimklConnect,
      onDisconnect: handleSimklDisconnect,
      onSync: handleSimklSync,
    },
    anilist: {
      authError: anilistAuthError,
      onConnect: handleAnilistConnect,
      onDisconnect: handleAnilistDisconnect,
      isMetaSyncing: isAnilistMetaSyncing,
      metaSyncMessage: anilistMetaSyncMessage,
      metaStats: anilistMetaStats,
      onMetaSync: handleAnilistMetaSync,
      isCatalogCrawling: isAnilistCatalogCrawling,
      catalogCrawlMessage: anilistCatalogCrawlMessage,
      catalogStats: anilistCatalogStats,
      onCatalogCrawl: handleAnilistCatalogCrawl,
      isImporting: isAnilistImporting,
      importResult: anilistImportResult,
      importStoredCount: anilistImportStoredCount,
      onPersonalImport: handleAnilistPersonalImport,
      pushStats: anilistPushStats,
      onPush: handleAnilistPush,
    },
  };
}
