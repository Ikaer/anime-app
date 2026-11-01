import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { AnimePageLayout, AnimeListHeader, AnimeCardView } from '@/components/anime';
import {
  RecommendationsSection,
  RecoFiltersSection,
  RecoWeightPresetsSection,
  RecoWeightsSection,
  RecoSeedsSection,
  GenresSection,
} from '@/components/anime/sidebar';
import type { MutedSeed } from '@/components/anime/sidebar';
import { Button, CollapsibleSection } from '@/components/shared';
import { AnimeRecord } from '@/models/anime';
import type { RecoMeta } from '@/models/anime';
import { useRecommendationsUrlState } from '@/hooks';
import { encodeSourceWeights } from '@/lib/reco/weights';
import { useI18n } from '@/lib/i18n';

type RecoCard = AnimeRecord & { recoMeta?: RecoMeta };

export default function RecommendationsPage() {
  const { t, lang } = useI18n();
  const { state, update, setCardsPerRow, isReady } = useRecommendationsUrlState();

  // Feed data.
  const [animes, setAnimes] = useState<RecoCard[]>([]);
  const [mutedSeeds, setMutedSeeds] = useState<MutedSeed[]>([]);
  /** Ids the owner has credited the engine for — « Vu grâce à la reco ». */
  const [credited, setCredited] = useState<ReadonlySet<string>>(new Set());
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
    recos: true, views: true, seeds: false, weights: false, filters: true, genres: false, display: true,
  });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  // No MAL auth probe on mount: nothing on this page is gated on it any more.
  // The refresh route decides per source what it can run.

  /**
   * ⚠️ **Last request wins, not last response.** Several loads are in flight at
   * once in normal use — the effect refires as `useViewDefaults` resolves, and
   * again on every URL change — and they do NOT come back in order: the
   * « Ignorés » list is a plain store read while the feed is a full ranking, so
   * switching to the list resolved first and a feed response still in flight
   * then overwrote it. Live symptom: « Ignorés » rendered the whole feed, every
   * card offering « ↩ Remettre » on a title that was never ignored. Nothing
   * errored, so the only trace was two extra 200s in the network log.
   */
  const loadSeq = useRef(0);

  const loadFeed = useCallback(async () => {
    const seq = ++loadSeq.current;
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
      // All three genre axes ride in one param — the split is presentation only.
      if (state.genres.length > 0) params.set('genres', state.genres.join(','));

      // Per-source weights (only non-defaults are emitted).
      const wStr = encodeSourceWeights(state.weights);
      if (wStr) params.set('w', wStr);
      params.set('lang', lang);

      if (state.review) {
        params.set('review', '1');
      } else {
        if (state.secondChance) params.set('pool', 'dropped');
        if (state.nicheMode) params.set('nicheMode', 'true');
        if (state.threshold !== null) params.set('threshold', String(state.threshold));
        if (state.diversity !== null && state.diversity > 0) params.set('diversity', String(state.diversity));
      }

      const res = await fetch(`/api/anime/recommendations?${params.toString()}`);
      if (seq !== loadSeq.current) return; // superseded — keep the newer answer
      if (res.ok) {
        const data = await res.json();
        if (seq !== loadSeq.current) return;
        setAnimes(data.animes || []);
        setMutedSeeds(data.mutedSeeds || []);
        setCredited(new Set<string>(data.credited || []));
        if (!state.review) setRecoLastRefresh(data.lastRefresh ?? null);
      } else {
        const errorData = await res.json().catch(() => ({}));
        setError(errorData.error || t('reco.loadFailed'));
      }
    } catch {
      if (seq === loadSeq.current) setError(t('reco.loadFailed'));
    } finally {
      if (seq === loadSeq.current) setIsLoading(false);
    }
  }, [state, lang, t]);

  useEffect(() => {
    if (!isReady) return;
    loadFeed();
  }, [isReady, loadFeed]);

  // No MAL gate: the refresh runs on whatever sources are available, falling
  // back to the anonymous AniList crowd source when there is no MAL account
  // The route reports which pipes it skipped.
  const handleRefreshRecos = async () => {
    setIsRefreshingRecos(true);
    setRecoError('');
    setRecoProgress(t('dataSync.starting'));
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
          setRecoError(p.details || p.error || t('reco.refreshFailed'));
        }
      };
      es.onerror = () => {
        es.close();
        setIsRefreshingRecos(false);
      };
    } catch {
      setRecoError(t('reco.refreshStartFailed'));
      setIsRefreshingRecos(false);
      setRecoProgress('');
    }
  };

  /**
   * « Vu grâce à la reco » on a feed card.
   *
   * ⚠️ The card does NOT move. Unlike the ignore right below, this records
   * something about the past rather than changing what should be shown — and a
   * pick is usually made alongside four others, so a card vanishing under the
   * cursor would both lose the reader's place and read as a dismissal.
   * Optimistic, with a revert: the write is a single durable id and the toggle
   * must feel instant while the playlist is being built.
   */
  const handleRecoCredit = async (animeId: string, credited: boolean) => {
    setCredited(prev => {
      const next = new Set(prev);
      if (credited) next.add(animeId); else next.delete(animeId);
      return next;
    });
    try {
      const res = await fetch(`/api/anime/animes/${animeId}/reco-credit`, {
        method: credited ? 'POST' : 'DELETE',
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      setCredited(prev => {
        const next = new Set(prev);
        if (credited) next.delete(animeId); else next.add(animeId);
        return next;
      });
      setError(t('reco.recoCreditFailed'));
    }
  };

  /**
   * « Ignorer » on a feed card: file the id and drop the card locally.
   *
   * Local drop rather than a refetch, and that is the difference from a seed
   * mute right below: an ignore changes nothing about how the other candidates
   * score, so re-ranking the whole feed would move cards the reader was not
   * acting on. A mute genuinely re-ranks and therefore has to refetch.
   */
  const handleIgnore = async (animeId: string) => {
    try {
      const response = await fetch(`/api/anime/recommendations/ignore/${animeId}`, { method: 'POST' });
      if (response.ok) {
        setAnimes(prev => prev.filter(a => a.id !== animeId));
      } else {
        setError(t('reco.ignoreSaveFailed'));
      }
    } catch {
      setError(t('reco.ignoreSaveFailed'));
    }
  };

  /**
   * « Ne plus partir de ce titre » / « Repartir de ce titre ».
   *
   * Both refetch rather than patching state locally: a mute changes which
   * candidates EXIST and how every remaining one scores, so there is no
   * optimistic edit that would be honest — dropping the muted seed's cards
   * client-side would leave the rest of the feed at its old ranks and positions.
   */
  const setSeedMute = async (seedId: string, muted: boolean) => {
    try {
      const res = await fetch(`/api/anime/animes/${seedId}/seed-mute`, {
        method: muted ? 'POST' : 'DELETE',
      });
      if (!res.ok) throw new Error('failed');
      // Muting is most often done from a CARD, where the only feedback would
      // otherwise be the feed quietly re-ranking. Opening « Sources » puts the
      // title that just went quiet — and its ↩ undo — directly in view.
      if (muted) setExpanded(prev => ({ ...prev, seeds: true }));
      await loadFeed();
    } catch {
      setError(t('reco.seedMuteFailed'));
    }
  };

  // ↩ Remettre from the « Ignorés » list: un-ignore and drop it from the list.
  const handleRestoreIgnored = async (animeId: string) => {
    try {
      const response = await fetch(`/api/anime/recommendations/ignore/${animeId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setAnimes(prev => prev.filter(a => a.id !== animeId));
      } else {
        setError(t('reco.ignoreRemoveFailed'));
      }
    } catch {
      setError(t('reco.ignoreRemoveFailed'));
    }
  };

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection title={t('section.recommendations')} isExpanded={expanded.recos} onToggle={() => toggle('recos')}>
        <RecommendationsSection
          isRefreshingRecos={isRefreshingRecos}
          recoProgress={recoProgress}
          recoLastRefresh={recoLastRefresh}
          recoError={recoError}
          nicheMode={state.nicheMode}
          threshold={state.threshold}
          diversity={state.diversity}
          onRefreshRecos={handleRefreshRecos}
          onNicheModeChange={(v) => update({ nicheMode: v })}
          onThresholdChange={(v) => update({ threshold: v })}
          onDiversityChange={(v) => update({ diversity: v })}
          onShowIgnored={() => update({ review: true, secondChance: false })}
          onShowSecondChance={() => update({ secondChance: true, review: false })}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t('section.views')} isExpanded={expanded.views} onToggle={() => toggle('views')}>
        <RecoWeightPresetsSection onApply={(w) => update({ weights: w })} />
      </CollapsibleSection>

      {/* Only on the feed itself — the « Ignorés » sub-view (`rev=1`) is a flat
          list with no seeds behind it, so the tally would read 0. */}
      {!state.review && (
        <CollapsibleSection
          title={mutedSeeds.length > 0
            ? t('reco.section.seedsMuted', { count: mutedSeeds.length })
            : t('reco.section.seeds')}
          isExpanded={expanded.seeds}
          onToggle={() => toggle('seeds')}
        >
          <RecoSeedsSection
            metas={animes.map(a => a.recoMeta).filter((m): m is RecoMeta => !!m)}
            muted={mutedSeeds}
            onMute={(id) => setSeedMute(id, true)}
            onUnmute={(id) => setSeedMute(id, false)}
          />
        </CollapsibleSection>
      )}

      <CollapsibleSection title={t('reco.sourceWeights')} isExpanded={expanded.weights} onToggle={() => toggle('weights')}>
        <RecoWeightsSection
          weights={state.weights}
          onWeightsChange={(w) => update({ weights: w })}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t('section.filters')} isExpanded={expanded.filters} onToggle={() => toggle('filters')}>
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

      {/* Its own section rather than a block inside Filters, same reason as the
          main list: 78 values across three axes is the longest control here, and
          collapsing it independently keeps the weight sliders reachable. Starts
          collapsed — this page's headline controls are the engine knobs. */}
      <CollapsibleSection title={t('section.genres')} isExpanded={expanded.genres} onToggle={() => toggle('genres')}>
        <GenresSection genres={state.genres} onGenresChange={(v) => update({ genres: v })} />
      </CollapsibleSection>

    </div>
  );

  return (
    <>
      <Head>
        <title>{t('reco.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="reco-main-content">
          {error && (
            <div className="error-banner">
              {error} <button onClick={() => setError('')}>×</button>
            </div>
          )}

          {/* The same header component `/` renders — no `sort`, because the
              feed's order IS the affinity ranking. */}
          <AnimeListHeader
            title={
              state.review ? t('reco.ignored')
                : state.secondChance ? t('reco.secondChance')
                  : t('nav.forYou')
            }
            count={state.review
              ? (
                <Button variant="secondary" size="xs" onClick={() => update({ review: false })}>
                  {t('reco.backToRecos')}
                </Button>
              )
              : state.secondChance
                ? (
                  <>
                    {t('reco.countTitles', { count: animes.length })}{' '}
                    <Button variant="secondary" size="xs" onClick={() => update({ secondChance: false })}>
                      {t('reco.backToRecos')}
                    </Button>
                  </>
                )
                : t('reco.countTitles', { count: animes.length })}
            display={{
              cardsPerRow: state.cardsPerRow,
              onCardsPerRowChange: setCardsPerRow,
            }}
          >
            <Button variant="secondary" size="xs" onClick={() => setShowAllExplains(v => !v)}>
              {showAllExplains ? t('reco.hideExplains') : t('reco.showExplains')}
            </Button>
          </AnimeListHeader>

          <div className="cards-container">
            {!isReady || isLoading ? (
              <div className="loading-state">{t('common.loading')}</div>
            ) : (
              <AnimeCardView
                animes={animes}
                cardsPerRow={state.cardsPerRow}
                onIgnore={handleIgnore}
                onRestoreIgnored={handleRestoreIgnored}
                ignoreMode={state.review ? 'review' : 'offer'}
                onRecoCredit={state.review ? undefined : handleRecoCredit}
                creditedIds={credited}
                allExplainsOpen={showAllExplains}
                onMuteSeed={state.review ? undefined : (seedId) => setSeedMute(seedId, true)}
              />
            )}
          </div>
        </div>
      </AnimePageLayout>
      <style jsx>{`
        .reco-main-content { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .cards-container { background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }
      `}</style>
    </>
  );
}
