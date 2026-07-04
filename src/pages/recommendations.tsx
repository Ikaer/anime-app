import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { AnimePageLayout, AnimeCardView } from '@/components/anime';
import {
  AccountSection,
  RecommendationsSection,
  RecoFiltersSection,
  RecoWeightPresetsSection,
  RecoWeightsSection,
  DisplaySection,
} from '@/components/anime/sidebar';
import { Button, CollapsibleSection } from '@/components/shared';
import { AnimeForDisplay, MALAuthState, ImageSize } from '@/models/anime';
import type { RecoMeta } from '@/models/anime';
import { useRecommendationsUrlState } from '@/hooks';
import { encodeSourceWeights } from '@/lib/recoWeights';

type RecoCard = AnimeForDisplay & { recoMeta?: RecoMeta };

export default function RecommendationsPage() {
  const { state, update, isReady } = useRecommendationsUrlState();

  // Auth (needed to gate the refresh button).
  const [authState, setAuthState] = useState<MALAuthState>({ isAuthenticated: false });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Feed data.
  const [animes, setAnimes] = useState<RecoCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Refresh (SSE) state.
  const [isRefreshingRecos, setIsRefreshingRecos] = useState(false);
  const [recoProgress, setRecoProgress] = useState('');
  const [recoLastRefresh, setRecoLastRefresh] = useState<string | null>(null);
  const [recoError, setRecoError] = useState('');

  // Show every card's "Pourquoi ?" breakdown at once (ephemeral display pref).
  const [showAllExplains, setShowAllExplains] = useState(false);

  // Sidebar collapse state (local — not URL-persisted on this page).
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    account: true, recos: true, views: true, weights: false, filters: true, display: true,
  });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const checkAuthStatus = async () => {
    try {
      setIsAuthLoading(true);
      const response = await fetch('/api/anime/auth?action=status');
      const data = await response.json();
      setAuthState({ isAuthenticated: data.isAuthenticated, user: data.user });
    } catch {
      setAuthError('Failed to check authentication status');
    } finally {
      setIsAuthLoading(false);
    }
  };

  useEffect(() => { checkAuthStatus(); }, []);

  const loadFeed = useCallback(async () => {
    try {
      setIsLoading(true);
      setError('');

      const params = new URLSearchParams();
      // Narrowing filters (shared with the main list, applied after ranking).
      if (state.mediaTypes.length > 0) params.set('mediaType', state.mediaTypes.join(','));
      if (state.search) params.set('search', state.search);
      if (state.minScore !== null) params.set('minScore', String(state.minScore));
      if (state.maxScore !== null) params.set('maxScore', String(state.maxScore));
      if (state.minYear !== null) params.set('minYear', String(state.minYear));
      if (state.maxYear !== null) params.set('maxYear', String(state.maxYear));

      // Per-source weights (only non-defaults are emitted).
      const wStr = encodeSourceWeights(state.weights);
      if (wStr) params.set('w', wStr);

      if (state.review) {
        params.set('review', state.review);
      } else {
        if (state.nicheMode) params.set('nicheMode', 'true');
        if (state.threshold !== null) params.set('threshold', String(state.threshold));
      }

      const res = await fetch(`/api/anime/recommendations?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAnimes(data.animes || []);
        if (!state.review) setRecoLastRefresh(data.lastRefresh ?? null);
      } else {
        const errorData = await res.json().catch(() => ({}));
        setError(errorData.error || 'Failed to load recommendations');
      }
    } catch {
      setError('Failed to load recommendations');
    } finally {
      setIsLoading(false);
    }
  }, [state]);

  useEffect(() => {
    if (!isReady) return;
    loadFeed();
  }, [isReady, loadFeed]);

  const handleRefreshRecos = async () => {
    if (!authState.isAuthenticated) return;
    setIsRefreshingRecos(true);
    setRecoError('');
    setRecoProgress('Démarrage...');
    try {
      const startParams = new URLSearchParams();
      if (state.nicheMode) startParams.set('nicheMode', 'true');
      if (state.threshold !== null) startParams.set('threshold', String(state.threshold));
      const res = await fetch(`/api/anime/recommendations/refresh?${startParams.toString()}`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start refresh');
      const { syncId } = await res.json();

      // Stream progress over SSE (works over plain HTTP — not a secure-context API).
      const es = new EventSource(`/api/anime/recommendations/refresh?syncId=${syncId}`);
      es.onmessage = (event) => {
        const p = JSON.parse(event.data);
        if (p.message) setRecoProgress(p.message);
        if (p.type === 'complete') {
          es.close();
          setIsRefreshingRecos(false);
          setRecoProgress('');
          loadFeed();
        } else if (p.type === 'error') {
          es.close();
          setIsRefreshingRecos(false);
          setRecoProgress('');
          setRecoError(p.details || p.error || 'Refresh failed');
        }
      };
      es.onerror = () => {
        es.close();
        setIsRefreshingRecos(false);
      };
    } catch {
      setRecoError('Failed to start recommendations refresh.');
      setIsRefreshingRecos(false);
      setRecoProgress('');
    }
  };

  // 👍/👎 on a feed card: persist the verdict and drop it from the live list.
  const handleFeedback = async (animeId: number, verdict: 'up' | 'down') => {
    try {
      const response = await fetch(`/api/anime/recommendations/feedback/${animeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict }),
      });
      if (response.ok) {
        setAnimes(prev => prev.filter(a => a.id !== animeId));
      } else {
        setError('Impossible d’enregistrer le retour.');
      }
    } catch {
      setError('Impossible d’enregistrer le retour.');
    }
  };

  // ↩ Remettre from a review list: clear the verdict and drop it from the list.
  const handleRemoveFeedback = async (animeId: number) => {
    try {
      const response = await fetch(`/api/anime/recommendations/feedback/${animeId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setAnimes(prev => prev.filter(a => a.id !== animeId));
      } else {
        setError('Impossible de retirer le retour.');
      }
    } catch {
      setError('Impossible de retirer le retour.');
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
            ? { ...a, my_list_status: { ...a.my_list_status, ...updates } as any }
            : a
        ));
      } else {
        throw new Error('Failed to update MAL status');
      }
    } catch (err) {
      setError('Failed to update MAL status.');
      throw err;
    }
  };

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection title="Account" isExpanded={expanded.account} onToggle={() => toggle('account')}>
        <AccountSection
          authState={authState}
          isAuthLoading={isAuthLoading}
          authError={authError}
          onConnect={async () => {
            const response = await fetch('/api/anime/auth?action=login');
            const data = await response.json();
            if (data.authUrl) window.location.href = data.authUrl;
          }}
          onDisconnect={async () => {
            await fetch('/api/anime/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
            setAuthState({ isAuthenticated: false });
          }}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Recommandations" isExpanded={expanded.recos} onToggle={() => toggle('recos')}>
        <RecommendationsSection
          authState={authState}
          isRefreshingRecos={isRefreshingRecos}
          recoProgress={recoProgress}
          recoLastRefresh={recoLastRefresh}
          recoError={recoError}
          nicheMode={state.nicheMode}
          threshold={state.threshold}
          onRefreshRecos={handleRefreshRecos}
          onNicheModeChange={(v) => update({ nicheMode: v })}
          onThresholdChange={(v) => update({ threshold: v })}
          onShowLiked={() => update({ review: 'up' })}
          onShowDisliked={() => update({ review: 'down' })}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Views" isExpanded={expanded.views} onToggle={() => toggle('views')}>
        <RecoWeightPresetsSection onApply={(w) => update({ weights: w })} />
      </CollapsibleSection>

      <CollapsibleSection title="Pondération des sources" isExpanded={expanded.weights} onToggle={() => toggle('weights')}>
        <RecoWeightsSection
          weights={state.weights}
          onWeightsChange={(w) => update({ weights: w })}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Filtres" isExpanded={expanded.filters} onToggle={() => toggle('filters')}>
        <RecoFiltersSection
          search={state.search}
          onSearchChange={(v) => update({ search: v })}
          mediaTypes={state.mediaTypes}
          onMediaTypesChange={(v) => update({ mediaTypes: v })}
          minScore={state.minScore}
          onMinScoreChange={(v) => update({ minScore: v })}
          maxScore={state.maxScore}
          onMaxScoreChange={(v) => update({ maxScore: v })}
          minYear={state.minYear}
          maxYear={state.maxYear}
          onYearChange={(min, max) => update({ minYear: min, maxYear: max })}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Display" isExpanded={expanded.display} onToggle={() => toggle('display')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <DisplaySection
            imageSize={state.imageSize}
            onImageSizeChange={(size: ImageSize) => update({ imageSize: size })}
          />
          <Button variant="secondary" size="xs" onClick={() => setShowAllExplains(v => !v)}>
            {showAllExplains ? 'Masquer les explications' : 'Afficher les explications'}
          </Button>
        </div>
      </CollapsibleSection>
    </div>
  );

  return (
    <>
      <Head>
        <title>Pour toi - Anime List</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="reco-main-content">
          {error && (
            <div className="error-banner">
              {error} <button onClick={() => setError('')}>×</button>
            </div>
          )}

          <div className="reco-header">
            <h1 className="reco-title">
              {state.review === 'up' ? '👍 Bonnes pioches'
                : state.review === 'down' ? '👎 Pas pour moi'
                : '✨ Pour toi'}
            </h1>
            {state.review ? (
              <Button variant="secondary" size="xs" onClick={() => update({ review: null })}>
                ← Retour aux recommandations
              </Button>
            ) : (
              <span className="reco-count">{animes.length} titres</span>
            )}
          </div>

          <div className="table-container">
            {!isReady || isLoading ? (
              <div className="loading-state">Loading...</div>
            ) : (
              <AnimeCardView
                animes={animes}
                imageSize={state.imageSize}
                visibleColumns={{ score: true, rank: false, popularity: false, users: false, scorers: false }}
                onUpdateMALStatus={handleUpdateMALStatus}
                onFeedback={handleFeedback}
                onRemoveFeedback={handleRemoveFeedback}
                feedbackMode={state.review ?? 'feed'}
                allExplainsOpen={showAllExplains}
              />
            )}
          </div>
        </div>
      </AnimePageLayout>
      <style jsx>{`
        .reco-main-content { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .reco-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
        .reco-title { font-size: 1.5rem; margin: 0; color: var(--text-primary); }
        .reco-count { color: var(--text-secondary); }
        .table-container { background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }
      `}</style>
    </>
  );
}
