/**
 * "/mix" — recommendations anchored on a hand-picked set of anime.
 *
 * The middle ground between the detail page's "Plus comme ça" (one anchor, no
 * choice — it is whatever title you are looking at) and "/recommendations"
 * (every high-scored completion in your list, no choice either). Here YOU pick
 * the seeds, and the feed re-ranks on every add/remove.
 *
 * Its own route with its own URL state, for the reason `/recommendations` has
 * one: an anchor set is not a filter combination and has no place in
 * `AnimeFiltersState`. It composes the same sidebar sections and the same
 * `AnimeListHeader` + `AnimeCardView` as the feed, so the two read as one app —
 * what differs is the anchor picker at the top of the sidebar and the fact that
 * ranking here is anchored (see `lib/reco/anchored.ts`).
 *
 * Like the feed it passes NO `sort` to the header: the order IS the ranking.
 */
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { AnimePageLayout, AnimeListHeader, AnimeCardView } from '@/components/anime';
import {
  MixAnchorsSection,
  RecoFiltersSection,
  RecoWeightsSection,
  GenresSection,
  type MixAnchor,
} from '@/components/anime/sidebar';
import { Button, CollapsibleSection } from '@/components/shared';
import { AnimeRecord } from '@/models/anime';
import type { RecoMeta } from '@/models/anime';
import { useMixUrlState, MAX_ANCHORS } from '@/hooks';
import { encodeSourceWeights, ANCHORED_WEIGHTS, ANCHORED_SOURCES } from '@/lib/reco/weights';
import { useI18n } from '@/lib/i18n';

type RecoCard = AnimeRecord & { recoMeta?: RecoMeta };

interface MixSources {
  mal?: { ok: boolean; error?: string };
  anilist?: { ok: boolean; error?: string };
}

export default function MixPage() {
  const { t, lang } = useI18n();
  const { state, update, addAnchor, removeAnchor, setCardsPerRow, isReady } = useMixUrlState();

  const [animes, setAnimes] = useState<RecoCard[]>([]);
  /** Resolved server-side, so a bookmarked `?a=a_1,a_2` renders real chips. */
  const [anchors, setAnchors] = useState<MixAnchor[]>([]);
  const [sources, setSources] = useState<MixSources>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [showAllExplains, setShowAllExplains] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    anchors: true, filters: true, genres: false, weights: false,
  });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const anchorKey = state.anchors.join(',');

  const loadMix = useCallback(async () => {
    if (state.anchors.length === 0) {
      setAnimes([]); setAnchors([]); setSources({}); setError('');
      return;
    }
    try {
      setIsLoading(true);
      setError('');

      const params = new URLSearchParams();
      params.set('ids', anchorKey);
      if (state.includeSeen) params.set('includeSeen', 'true');
      if (state.mediaTypes.length > 0) params.set('mediaType', state.mediaTypes.join(','));
      if (state.search) params.set('search', state.search);
      if (state.minScore !== null) params.set('minScore', String(state.minScore));
      if (state.maxScore !== null) params.set('maxScore', String(state.maxScore));
      if (state.minYear !== null) params.set('minYear', String(state.minYear));
      if (state.maxYear !== null) params.set('maxYear', String(state.maxYear));
      if (state.genres.length > 0) params.set('genres', state.genres.join(','));
      const wStr = encodeSourceWeights(state.weights, ANCHORED_WEIGHTS);
      if (wStr) params.set('w', wStr);
      params.set('lang', lang);

      const res = await fetch(`/api/anime/recommendations/mix?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAnimes(data.animes || []);
        setAnchors(data.anchors || []);
        setSources(data.sources || {});
      } else {
        setError(data.error || t('mix.loadFailed'));
      }
    } catch {
      setError(t('mix.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [state, anchorKey, lang, t]);

  useEffect(() => {
    if (!isReady) return;
    loadMix();
  }, [isReady, loadMix]);

  // A dead pipe is declared rather than left as a mysteriously thin feed — same
  // shape as the refresh's per-source outcomes. MAL needs auth, AniList doesn't.
  const degraded = [
    sources.mal && !sources.mal.ok ? t('mix.sourceDown', { source: 'MAL', error: sources.mal.error || '' }) : null,
    sources.anilist && !sources.anilist.ok ? t('mix.sourceDown', { source: 'AniList', error: sources.anilist.error || '' }) : null,
  ].filter(Boolean) as string[];

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection title={t('mix.section.anchors')} isExpanded={expanded.anchors} onToggle={() => toggle('anchors')}>
        <MixAnchorsSection
          anchors={anchors}
          onAdd={addAnchor}
          onRemove={removeAnchor}
          max={MAX_ANCHORS}
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

      <CollapsibleSection title={t('section.genres')} isExpanded={expanded.genres} onToggle={() => toggle('genres')}>
        <GenresSection genres={state.genres} onGenresChange={(v) => update({ genres: v })} />
      </CollapsibleSection>

      {/* Only the sources an anchored ranking actually uses — `suggestions` and
          `feedback` are user-global and forced to 0 here. */}
      <CollapsibleSection title={t('reco.sourceWeights')} isExpanded={expanded.weights} onToggle={() => toggle('weights')}>
        <RecoWeightsSection
          weights={state.weights}
          onWeightsChange={(w) => update({ weights: w })}
          sources={ANCHORED_SOURCES}
        />
      </CollapsibleSection>
    </div>
  );

  return (
    <>
      <Head>
        <title>{t('mix.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="mix-main-content">
          {error && (
            <div className="error-banner">
              {error} <button onClick={() => setError('')}>×</button>
            </div>
          )}
          {degraded.map(msg => <div key={msg} className="warn-banner">{msg}</div>)}

          <AnimeListHeader
            title={t('nav.mix')}
            count={t('reco.countTitles', { count: animes.length })}
            display={{
              cardsPerRow: state.cardsPerRow,
              onCardsPerRowChange: setCardsPerRow,
            }}
          >
            <Button
              variant={state.includeSeen ? 'primary' : 'secondary'}
              size="xs"
              onClick={() => update({ includeSeen: !state.includeSeen })}
              title={t('mix.includeSeenHint')}
            >
              {t('mix.includeSeen')}
            </Button>
            <Button variant="secondary" size="xs" onClick={() => setShowAllExplains(v => !v)}>
              {showAllExplains ? t('reco.hideExplains') : t('reco.showExplains')}
            </Button>
          </AnimeListHeader>

          <div className="cards-container">
            {!isReady || isLoading ? (
              <div className="loading-state">{t('common.loading')}</div>
            ) : state.anchors.length === 0 ? (
              <div className="loading-state">{t('mix.pickToStart')}</div>
            ) : (
              <AnimeCardView
                animes={animes}
                cardsPerRow={state.cardsPerRow}
                allExplainsOpen={showAllExplains}
              />
            )}
          </div>
        </div>
      </AnimePageLayout>
      <style jsx>{`
        .mix-main-content { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .warn-banner {
          background: rgba(245, 158, 11, 0.12);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.3);
          padding: 0.6rem 0.9rem;
          border-radius: 8px;
          font-size: 0.85rem;
        }
        .cards-container { background: var(--bg-primary); border-radius: 8px; border: 1px solid var(--border-color); overflow: hidden; }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }
      `}</style>
    </>
  );
}
