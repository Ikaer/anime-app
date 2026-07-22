import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { AnimePageLayout, AnimeSidebar, AnimeListHeader, AnimeCardView, FirstRunOnboarding } from '@/components/anime';
import { AnimeRecord, UserAnimeStatus } from '@/models/anime';
import { useAnimeUrlState } from '@/hooks';
import { useT } from '@/lib/i18n';

export default function AnimePage() {
  const t = useT();
  const { filters, display, updateFilters, updateDisplay, isReady } = useAnimeUrlState();

  // Data state
  const [animes, setAnimes] = useState<AnimeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  // First-run gate: null = checking, true = registry is empty → onboarding.
  // Keyed on the registry count (not the filtered list length), so a filter
  // combination that hides everything never false-positives into onboarding.
  const [storeEmpty, setStoreEmpty] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/anime/anilist/catalog-crawl')
      .then(r => (r.ok ? r.json() : null))
      .then(stats => setStoreEmpty(stats ? stats.totalCanonicalIds === 0 : false))
      .catch(() => setStoreEmpty(false));
  }, []);

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

      // Discrepancies only (MAL vs SIMKL mismatch)
      if (filters.discrepanciesOnly) params.set('discrepancies', 'true');

      // Unrated only (completed but not yet scored)
      if (filters.unratedOnly) params.set('unrated', 'true');

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
        setError(errorData.error || t('index.loadFailed'));
      }
    } catch (error) {
      console.error('Error loading animes:', error);
      setError(t('index.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [filters, t]);

  // Load animes when filters change
  useEffect(() => {
    if (!isReady) return;
    loadAnimes();
  }, [isReady, loadAnimes]);

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

  const handleDiscrepanciesOnlyChange = (discrepanciesOnly: boolean) => {
    updateFilters({ discrepanciesOnly });
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

  // Display handlers - update URL
  const handleCardsPerRowChange = (cardsPerRow: number | null) => {
    updateDisplay({ cardsPerRow });
  };

  const handleSidebarExpandedChange = (section: string, isExpanded: boolean) => {
    const newExpanded = { ...display.sidebarExpanded, [section]: isExpanded };
    updateDisplay({ sidebarExpanded: newExpanded });
  };

  // Anime action handlers
  const handleHideToggle = async (animeId: string, hide: boolean) => {
    try {
      const response = await fetch(`/api/anime/animes/${animeId}/hide`, {
        method: hide ? 'POST' : 'DELETE'
      });
      if (response.ok) {
        setAnimes(prev => prev.filter(a => a.id !== animeId));
      } else {
        setError(hide ? t('index.hideFailed') : t('index.unhideFailed'));
      }
    } catch {
      setError(hide ? t('index.hideFailed') : t('index.unhideFailed'));
    }
  };

  const sidebar = (
    <AnimeSidebar
      statusFilters={filters.statusFilters}
      onStatusFilterChange={handleStatusFilterChange}
      seasons={filters.seasons}
      onSeasonsChange={handleSeasonsChange}
      mediaTypes={filters.mediaTypes}
      onMediaTypesChange={handleMediaTypesChange}
      hiddenOnly={filters.hiddenOnly}
      onHiddenOnlyChange={handleHiddenOnlyChange}
      discrepanciesOnly={filters.discrepanciesOnly}
      onDiscrepanciesOnlyChange={handleDiscrepanciesOnlyChange}
      minScore={filters.minScore}
      onMinScoreChange={handleMinScoreChange}
      maxScore={filters.maxScore}
      onMaxScoreChange={handleMaxScoreChange}
      searchQuery={filters.searchQuery}
      onSearchChange={handleSearchChange}
      sidebarExpanded={display.sidebarExpanded}
      onSidebarExpandedChange={handleSidebarExpandedChange}
    />
  );

  // First-run experience: an empty store gets the onboarding hero (data path,
  // settings link, AniList bulk-crawl launcher) instead of a bare empty list.
  if (storeEmpty === true) {
    return (
      <>
        <Head>
          <title>{t('index.pageTitle')}</title>
          <meta name="description" content={t('index.metaDescription')} />
          <link rel="icon" href="/anime-favicon.svg" />
        </Head>
        <FirstRunOnboarding
          onCatalogLoaded={() => {
            setStoreEmpty(false);
            loadAnimes();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{t('index.pageTitle')}</title>
        <meta name="description" content={t('index.metaDescription')} />
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="anime-main-content">
          {error && (
            <div className="error-banner">
              {error} <button onClick={() => setError('')}>×</button>
            </div>
          )}
          <AnimeListHeader
            count={t('stats.totalAnime', { count: animes.length })}
            sort={{
              sortBy: filters.sortBy,
              sortDir: filters.sortDir,
              onSortByChange: handleSortByChange,
              onSortDirChange: handleSortDirChange,
            }}
            cardsPerRow={display.cardsPerRow}
            onCardsPerRowChange={handleCardsPerRowChange}
          />
          <div className="cards-container">
            {!isReady || isLoading || storeEmpty === null ? (
              <div className="loading-state">{t('common.loading')}</div>
            ) : (
              <AnimeCardView
                animes={animes}
                cardsPerRow={display.cardsPerRow}
                onHideToggle={handleHideToggle}
              />
            )}
          </div>
        </div>
      </AnimePageLayout>
      <style jsx>{`
        .anime-main-content { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .cards-container { background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }
      `}</style>
    </>
  );
}
