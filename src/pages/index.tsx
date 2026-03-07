import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AnimePageLayout, AnimeSidebar, AnimeTable, AnimeCardView } from '@/components/anime';
import { AnimeWithExtensions, MALAuthState, UserAnimeStatus, StatsColumn } from '@/models/anime';
import { useAnimeUrlState } from '@/hooks';

export default function AnimePage() {
  const router = useRouter();
  const { filters, display, updateFilters, updateDisplay, isReady } = useAnimeUrlState();

  // Auth state (not URL-controlled)
  const [authState, setAuthState] = useState<MALAuthState>({ isAuthenticated: false });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Sync state (not URL-controlled)
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBigSyncing, setIsBigSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  // Data state
  const [animes, setAnimes] = useState<AnimeWithExtensions[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

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

  const loadAnimes = useCallback(async () => {
    try {
      setIsLoading(true);
      setError('');

      const params = new URLSearchParams();

      // Status filter
      const statusQuery = filters.statusFilters.join(',');
      if (statusQuery) params.set('status', statusQuery);

      // Search
      if (filters.searchQuery) params.set('search', filters.searchQuery);

      // Seasons
      if (filters.seasons.length > 0) {
        const seasonParam = filters.seasons.map(s => `${s.year}-${s.season}`).join(',');
        params.set('season', seasonParam);
      }

      // Media types
      if (filters.mediaTypes.length > 0) {
        params.set('mediaType', filters.mediaTypes.join(','));
      }

      // Hidden
      params.set('hidden', filters.hiddenOnly ? 'true' : 'false');

      // Score range
      if (filters.minScore !== null) params.set('minScore', filters.minScore.toString());
      if (filters.maxScore !== null) params.set('maxScore', filters.maxScore.toString());

      // Sort
      params.set('sortBy', filters.sortBy);
      params.set('sortDir', filters.sortDir);

      const response = await fetch(`/api/anime/animes?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setAnimes(data.animes || []);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to load anime list');
      }
    } catch (error) {
      console.error('Error loading animes:', error);
      setError('Failed to load anime list');
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();
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
      // Remove auth param from URL without affecting other params
      const { auth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.isReady, router.query, router]);

  // Load animes when filters change
  useEffect(() => {
    if (!isReady) return;
    loadAnimes();
  }, [isReady, loadAnimes]);

  // Auth handlers
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

  // Sync handlers
  const handleSync = async () => {
    if (!authState.isAuthenticated) return;
    setIsSyncing(true);
    setSyncError('');
    try {
      const response = await fetch('/api/anime/sync', { method: 'POST' });
      if (!response.ok) throw new Error('Sync failed');
      loadAnimes();
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
      loadAnimes();
    } catch (error) {
      setSyncError('Failed to start big sync.');
    } finally {
      setIsBigSyncing(false);
    }
  };

  // Filter handlers - update URL
  const handleStatusFilterChange = (status: UserAnimeStatus | 'not_defined', isChecked: boolean) => {
    const newFilters = isChecked
      ? [...filters.statusFilters, status]
      : filters.statusFilters.filter(s => s !== status);
    updateFilters({ statusFilters: newFilters });
  };

  const handleSearchChange = (query: string) => {
    updateFilters({ searchQuery: query });
  };

  const handleSeasonsChange = (seasons: typeof filters.seasons) => {
    updateFilters({ seasons });
  };

  const handleMediaTypesChange = (mediaTypes: string[]) => {
    updateFilters({ mediaTypes });
  };

  const handleHiddenOnlyChange = (hiddenOnly: boolean) => {
    updateFilters({ hiddenOnly });
  };

  const handleMinScoreChange = (minScore: number | null) => {
    updateFilters({ minScore });
  };

  const handleMaxScoreChange = (maxScore: number | null) => {
    updateFilters({ maxScore });
  };

  const handleSortByChange = (sortBy: typeof filters.sortBy) => {
    updateFilters({ sortBy });
  };

  const handleSortDirChange = (sortDir: typeof filters.sortDir) => {
    updateFilters({ sortDir });
  };

  const handleLayoutChange = (layout: typeof display.layout) => {
    updateDisplay({ layout });
  };

  // Display handlers - update URL
  const handleImageSizeChange = (imageSize: typeof display.imageSize) => {
    updateDisplay({ imageSize });
  };

  const handleVisibleColumnsChange = (column: StatsColumn, isVisible: boolean) => {
    const newVisibleColumns = { ...display.visibleColumns, [column]: isVisible };
    updateDisplay({ visibleColumns: newVisibleColumns });
  };

  const handleSidebarExpandedChange = (section: string, isExpanded: boolean) => {
    const newExpanded = { ...display.sidebarExpanded, [section]: isExpanded };
    updateDisplay({ sidebarExpanded: newExpanded });
  };

  // Anime action handlers
  const handleHideToggle = async (animeId: number, hide: boolean) => {
    try {
      const response = await fetch(`/api/anime/animes/${animeId}/hide`, {
        method: hide ? 'POST' : 'DELETE'
      });
      if (response.ok) {
        setAnimes(prev => prev.filter(a => a.id !== animeId));
      } else {
        setError(`Failed to ${hide ? 'hide' : 'unhide'} anime.`);
      }
    } catch {
      setError(`Failed to ${hide ? 'hide' : 'unhide'} anime.`);
    }
  };

  const handleUpdateMALStatus = async (animeId: number, updates: any) => {
    try {
      const response = await fetch(`/api/anime/animes/${animeId}/mal-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (response.ok) {
        setAnimes(prev => prev.map(a =>
          a.id === animeId
            ? { ...a, my_list_status: { ...a.my_list_status, ...updates } }
            : a
        ));
      } else {
        throw new Error('Failed to update MAL status');
      }
    } catch (error) {
      setError('Failed to update MAL status.');
      throw error;
    }
  };

  // View preset navigation is now handled by ViewsSection via router.push

  const sidebar = (
    <AnimeSidebar
      authState={authState}
      isAuthLoading={isAuthLoading}
      authError={authError}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      isSyncing={isSyncing}
      isBigSyncing={isBigSyncing}
      syncError={syncError}
      onSync={handleSync}
      onBigSync={handleBigSync}
      imageSize={display.imageSize}
      onImageSizeChange={handleImageSizeChange}
      statusFilters={filters.statusFilters}
      onStatusFilterChange={handleStatusFilterChange}
      seasons={filters.seasons}
      onSeasonsChange={handleSeasonsChange}
      mediaTypes={filters.mediaTypes}
      onMediaTypesChange={handleMediaTypesChange}
      hiddenOnly={filters.hiddenOnly}
      onHiddenOnlyChange={handleHiddenOnlyChange}
      minScore={filters.minScore}
      onMinScoreChange={handleMinScoreChange}
      maxScore={filters.maxScore}
      onMaxScoreChange={handleMaxScoreChange}
      searchQuery={filters.searchQuery}
      onSearchChange={handleSearchChange}
      animeCount={animes.length}
      visibleColumns={display.visibleColumns}
      onVisibleColumnsChange={handleVisibleColumnsChange}
      sidebarExpanded={display.sidebarExpanded}
      onSidebarExpandedChange={handleSidebarExpandedChange}
      sortBy={filters.sortBy}
      sortDir={filters.sortDir}
      onSortByChange={handleSortByChange}
      onSortDirChange={handleSortDirChange}
      layout={display.layout}
      onLayoutChange={handleLayoutChange}
    />
  );

  return (
    <>
      <Head>
        <title>Anime List - MyHomeApp</title>
        <meta name="description" content="Track seasonal anime with MyAnimeList integration" />
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="anime-main-content">
          {error && (
            <div className="error-banner">
              {error} <button onClick={() => setError('')}>×</button>
            </div>
          )}
          <div className="table-container">
            {!isReady || isLoading ? (
              <div className="loading-state">Loading...</div>
            ) : display.layout === 'card' ? (
              <AnimeCardView
                animes={animes}
                imageSize={display.imageSize}
                visibleColumns={display.visibleColumns}
                onUpdateMALStatus={handleUpdateMALStatus}
                onHideToggle={handleHideToggle}
              />
            ) : (
              <AnimeTable
                animes={animes}
                imageSize={display.imageSize}
                visibleColumns={display.visibleColumns}
                sortColumn={filters.sortBy}
                sortDirection={filters.sortDir}
                onUpdateMALStatus={handleUpdateMALStatus}
                onHideToggle={handleHideToggle}
              />
            )}
          </div>
        </div>
      </AnimePageLayout>
      <style jsx>{`
        .anime-main-content { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .table-container { background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }
      `}</style>
    </>
  );
}
