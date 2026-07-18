import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { AnimePageLayout } from '@/components/anime';
import { RecoFiltersSection } from '@/components/anime/sidebar';
import filterStyles from '@/components/anime/sidebar/RecoFiltersSection.module.css';
import { Button, CollapsibleSection } from '@/components/shared';
import { AnimeRecord, ImageSize } from '@/models/anime';
import { applyNarrowingFilters, getEffectiveScore, getEffectiveStatus, getPrimaryTitle } from '@/lib/animeUtils';
import { useTierUrlState } from '@/hooks';
import { useT, TranslationKey } from '@/lib/i18n';

// Row 0 is the "à noter" tray (unrated); scores 10→1 carry MAL's word labels
// (localized via `tierWord.<n>`).
const TIER_SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

// The four statuses the board's fetch already scopes to (plan_to_watch excluded).
const TIER_STATUSES = ['watching', 'completed', 'on_hold', 'dropped'] as const;

// green (10) → red (1)
function scoreColor(n: number): string {
  return `hsl(${Math.round(((n - 1) / 9) * 120)}, 55%, 42%)`;
}

const THUMB_W: Record<ImageSize, number> = { 0: 46, 1: 62, 2: 84, 3: 112 };
const POSTER_RATIO = 0.7; // width / height

interface Preview { anime: AnimeRecord; x: number; y: number; }
interface QueueItem { id: string; score: number; prevScore: number; }

export default function TierPage() {
  const t = useT();
  const { state, update, isReady } = useTierUrlState();

  const [animes, setAnimes] = useState<AnimeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Optimistic score overrides layered on the fetched data (0 = unrated / tray).
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  // ---- Manual auto-scroll while dragging. Native HTML5 drag auto-scroll ----
  // doesn't fire reliably here, so we drive it ourselves. `scrollContainerRef`
  // points at the layout's `<main>`, but its `overflow-y:auto` never actually
  // engages (nothing in the ancestor chain gives it a bounded height, so the
  // box just grows and the page/document scrolls instead) — so we scroll
  // whichever of the two actually has overflow.
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const dragYRef = useRef<number | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const AUTO_SCROLL_EDGE = 80; // px from top/bottom edge that triggers scrolling
  const AUTO_SCROLL_MAX_SPEED = 18; // px per frame at the very edge

  useEffect(() => {
    if (draggingId === null) {
      dragYRef.current = null;
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      return;
    }

    const onWindowDragOver = (e: DragEvent) => { dragYRef.current = e.clientY; };
    window.addEventListener('dragover', onWindowDragOver);

    const tick = () => {
      const y = dragYRef.current;
      if (y !== null) {
        const inner = scrollContainerRef.current;
        const useInner = !!inner && inner.scrollHeight > inner.clientHeight;
        const scrollEl = useInner ? inner! : (document.scrollingElement || document.documentElement);
        const top = useInner ? inner!.getBoundingClientRect().top : 0;
        const bottom = useInner ? inner!.getBoundingClientRect().bottom : window.innerHeight;
        const distTop = y - top;
        const distBottom = bottom - y;
        if (distTop < AUTO_SCROLL_EDGE) {
          const speed = AUTO_SCROLL_MAX_SPEED * (1 - Math.max(distTop, 0) / AUTO_SCROLL_EDGE);
          scrollEl.scrollTop -= speed;
        } else if (distBottom < AUTO_SCROLL_EDGE) {
          const speed = AUTO_SCROLL_MAX_SPEED * (1 - Math.max(distBottom, 0) / AUTO_SCROLL_EDGE);
          scrollEl.scrollTop += speed;
        }
      }
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };
    autoScrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [draggingId]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ filters: true, display: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  // ---- Load: the user's watched list (statused, excluding plan_to_watch). ----
  // Everything is fetched once; filtering happens client-side so it never refetches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetch('/api/anime/animes?status=watching,completed,on_hold,dropped&limit=all');
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        if (!cancelled) setAnimes(data.animes || []);
      } catch {
        if (!cancelled) setError(t('tier.loadFailed'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Base (server-known) effective score per anime; 0 = unrated.
  const baseScore = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of animes) m.set(a.id, getEffectiveScore(a) ?? 0);
    return m;
  }, [animes]);

  const effScoreOf = useCallback(
    (id: string): number => (overrides.has(id) ? overrides.get(id)! : (baseScore.get(id) ?? 0)),
    [overrides, baseScore],
  );

  // Client-side narrowing (search / media type / mean range / year range / genres),
  // plus the tier board's own status filter (page-specific, so not in
  // applyNarrowingFilters — same reasoning as the main list page). OR semantics:
  // no box checked = no filter (show all four statuses already fetched).
  const filtered = useMemo(() => {
    let out = applyNarrowingFilters(animes, {
      search: state.search,
      mediaTypes: state.mediaTypes,
      minScore: state.minScore,
      maxScore: state.maxScore,
      minYear: state.minYear,
      maxYear: state.maxYear,
      genres: state.genres,
    });
    if (state.statuses.length > 0) {
      const wanted = new Set(state.statuses);
      out = out.filter(a => {
        const s = getEffectiveStatus(a);
        return !!s && wanted.has(s);
      });
    }
    return out;
  }, [animes, state.search, state.mediaTypes, state.minScore, state.maxScore, state.minYear, state.maxYear, state.genres, state.statuses]);

  // Distinct MAL genre names (not AniList tags) across the loaded list, alphabetized.
  const availableGenres = useMemo(() => {
    const names = new Set<string>();
    for (const a of animes) for (const g of a.catalog.genres || []) names.add(g.name);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [animes]);

  // Bucket the filtered list by effective score. Index 0 holds the tray.
  // Still-watching anime aren't done yet, so they're excluded from the tray
  // (unrated watching titles just don't appear on the board at all).
  const buckets = useMemo(() => {
    const b = new Map<number, AnimeRecord[]>();
    for (let s = 0; s <= 10; s++) b.set(s, []);
    for (const a of filtered) {
      const score = effScoreOf(a.id);
      if (score === 0 && getEffectiveStatus(a) === 'watching') continue;
      b.get(score)!.push(a);
    }
    for (const list of b.values()) list.sort((a, c) => getPrimaryTitle(a).localeCompare(getPrimaryTitle(c)));
    return b;
  }, [filtered, effScoreOf]);

  // ---- Serial write queue (respects SIMKL's 1 req/s + 20s per-user lock). ----
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (queueRef.current.length > 0) {
      const { id, score, prevScore } = queueRef.current.shift()!;
      setSaving(prev => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/anime/animes/${id}/rating`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || data.ok === false) {
          // Hard failure — nothing persisted. Revert the optimistic move.
          setOverrides(prev => new Map(prev).set(id, prevScore));
          setFailed(prev => new Map(prev).set(id, data.error || t('tier.saveFailed')));
        } else {
          // Persisted locally; warn if a remote push didn't take. Iterate the map
          // rather than naming providers — `writePersonal` fans out to every
          // ENABLED writer, so hardcoding mal/simkl silently swallowed AniList
          // once OAuth write-back shipped. `local` never lands here (its
          // writeRemote is a no-op that always reports ok), so it needs no filter.
          const outcomes: Record<string, { ok?: boolean }> = data.outcomes || {};
          const bad = Object.entries(outcomes)
            .filter(([, o]) => o && o.ok === false)
            .map(([provider]) => provider.toUpperCase());
          setFailed(prev => {
            const n = new Map(prev);
            if (bad.length) n.set(id, t('tier.notSynced', { sources: bad.join(' + ') }));
            else n.delete(id);
            return n;
          });
        }
      } catch {
        setOverrides(prev => new Map(prev).set(id, prevScore));
        setFailed(prev => new Map(prev).set(id, t('tier.networkError')));
      } finally {
        setSaving(prev => { const n = new Set(prev); n.delete(id); return n; });
      }
    }
    processingRef.current = false;
  }, []);

  const assignScore = useCallback((id: string, score: number) => {
    const prevScore = effScoreOf(id);
    if (prevScore === score) return;
    setOverrides(prev => new Map(prev).set(id, score));
    setFailed(prev => { const n = new Map(prev); n.delete(id); return n; });
    queueRef.current.push({ id, score, prevScore });
    processQueue();
  }, [effScoreOf, processQueue]);

  // ---- Drag & drop (native HTML5 — zero-dep; score is the only persisted state). ----
  const onDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(id);
    setPreview(null);
  };
  const onDragEnd = () => setDraggingId(null);
  const onDropTo = (e: React.DragEvent, score: number) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) assignScore(id, score);
    setDraggingId(null);
  };
  const allowDrop = (e: React.DragEvent) => e.preventDefault();

  // ---- Hover zoom: a single shared preview element (not 500 large imgs). ----
  const onCardEnter = (e: React.MouseEvent, anime: AnimeRecord) => {
    if (draggingId !== null) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const PREVIEW_W = 240;
    // Reserve the preview's real height so it never spills below the viewport:
    // the poster is PREVIEW_W wide at the poster ratio, plus the title/mean rows.
    const PREVIEW_H = Math.round(PREVIEW_W / POSTER_RATIO) + 60;
    // Prefer to the right of the card; flip left if it would overflow.
    const x = r.right + PREVIEW_W + 16 < window.innerWidth ? r.right + 8 : r.left - PREVIEW_W - 8;
    const y = Math.max(8, Math.min(r.top, window.innerHeight - PREVIEW_H - 8));
    setPreview({ anime, x, y });
  };
  const onCardLeave = () => setPreview(null);

  const thumbW = THUMB_W[state.thumbSize];
  const thumbH = Math.round(thumbW / POSTER_RATIO);

  const ratedCount = useMemo(() => {
    let n = 0;
    for (let s = 1; s <= 10; s++) n += buckets.get(s)!.length;
    return n;
  }, [buckets]);

  const renderCard = (a: AnimeRecord) => {
    const thumb = a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large || '';
    const isSaving = saving.has(a.id);
    const fail = failed.get(a.id);
    return (
      <div
        key={a.id}
        className={`card ${draggingId === a.id ? 'dragging' : ''} ${fail ? 'failed' : ''}`}
        draggable
        onDragStart={(e) => onDragStart(e, a.id)}
        onDragEnd={onDragEnd}
        onMouseEnter={(e) => onCardEnter(e, a)}
        onMouseLeave={onCardLeave}
        title={getPrimaryTitle(a)}
        style={{ width: thumbW, height: thumbH }}
      >
        {thumb
          ? <img src={thumb} alt="" loading="lazy" draggable={false} style={{ width: '100%', height: '100%' }} />
          : <div className="noimg">{getPrimaryTitle(a).slice(0, 2)}</div>}
        <a
          className="detail-link"
          href={`/anime/${a.id}`}
          target="_blank"
          rel="noopener noreferrer"
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          title={t('table.localInfo')}
        >↗</a>
        {isSaving && <span className="badge saving">…</span>}
        {!isSaving && fail && <span className="badge fail" title={fail}>!</span>}
      </div>
    );
  };

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection title={t('section.filters')} isExpanded={expanded.filters} onToggle={() => toggle('filters')}>
        <RecoFiltersSection
          search={state.search}
          onSearchChange={(v: string) => update({ search: v })}
          mediaTypes={state.mediaTypes}
          onMediaTypesChange={(v: string[]) => update({ mediaTypes: v })}
          minScore={state.minScore}
          onMinScoreChange={(v: number | null) => update({ minScore: v })}
          maxScore={state.maxScore}
          onMaxScoreChange={(v: number | null) => update({ maxScore: v })}
          minYear={state.minYear}
          maxYear={state.maxYear}
          onYearChange={(min: number | null, max: number | null) => update({ minYear: min, maxYear: max })}
        />

        <div className={filterStyles.filterGroup}>
          <label className={filterStyles.label}>{t('tier.statuses')}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {TIER_STATUSES.map(s => (
              <label key={s} className={filterStyles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={state.statuses.includes(s)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...state.statuses, s]
                      : state.statuses.filter(x => x !== s);
                    update({ statuses: next });
                  }}
                /> {t(`status.${s}` as TranslationKey)}
              </label>
            ))}
          </div>
        </div>

        {availableGenres.length > 0 && (
          <div className={filterStyles.filterGroup}>
            <label className={filterStyles.label}>{t('tier.genres')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
              {availableGenres.map(g => (
                <label key={g} className={filterStyles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={state.genres.includes(g)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...state.genres, g]
                        : state.genres.filter(x => x !== g);
                      update({ genres: next });
                    }}
                  /> {g}
                </label>
              ))}
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title={t('section.display')} isExpanded={expanded.display} onToggle={() => toggle('display')}>
        <div>
          <label className="thumb-label">{t('section.thumbnailSize')}</label>
          <div className="thumb-buttons">
            {([0, 1, 2, 3] as ImageSize[]).map(s => (
              <Button
                key={s}
                variant="secondary"
                size="xs"
                className={state.thumbSize === s ? 'thumb-active' : ''}
                onClick={() => update({ thumbSize: s })}
              >
                {['S', 'M', 'L', 'XL'][s]}
              </Button>
            ))}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );

  return (
    <>
      <Head>
        <title>{t('tier.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar} ref={scrollContainerRef}>
        <div className="tier-main">
          {error && <div className="error-banner">{error} <button onClick={() => setError('')}>×</button></div>}

          <div className="tier-header">
            <h1 className="tier-title">{t('nav.tierList')}</h1>
            <span className="tier-count">{t('tier.headerCount', { rated: ratedCount, toRate: buckets.get(0)!.length })}</span>
          </div>

          {!isReady || isLoading ? (
            <div className="loading-state">{t('common.loading')}</div>
          ) : (
            <div className="board">
              {TIER_SCORES.map(s => (
                <div key={s} className="tier-row" onDragOver={allowDrop} onDrop={(e) => onDropTo(e, s)}>
                  <div className="tier-label" style={{ background: scoreColor(s) }}>
                    <span className="tier-num">{s}</span>
                    <span className="tier-word">{t(`tierWord.${s}` as TranslationKey)}</span>
                  </div>
                  <div className="tier-cards">
                    {buckets.get(s)!.map(renderCard)}
                  </div>
                </div>
              ))}

              <div className="tray" onDragOver={allowDrop} onDrop={(e) => onDropTo(e, 0)}>
                <div className="tray-label">{t('tier.trayLabel', { count: buckets.get(0)!.length })}</div>
                <div className="tier-cards">
                  {buckets.get(0)!.map(renderCard)}
                </div>
              </div>
            </div>
          )}
        </div>
      </AnimePageLayout>

      {preview && (
        <div className="hover-preview" style={{ left: preview.x, top: preview.y }}>
          <img src={preview.anime.catalog.mainPicture?.large || preview.anime.catalog.mainPicture?.medium || ''} alt="" />
          <div className="hover-title">{getPrimaryTitle(preview.anime)}</div>
          {preview.anime.catalog.mean != null && <div className="hover-mean">MAL {preview.anime.catalog.mean.toFixed(2)}</div>}
        </div>
      )}

      <style jsx>{`
        .tier-main { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .tier-header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
        .tier-title { font-size: 1.5rem; margin: 0; color: var(--text-primary); }
        .tier-count { color: var(--text-secondary); }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }

        .board { display: flex; flex-direction: column; gap: 6px; }
        .tier-row { display: flex; align-items: stretch; gap: 8px; background: var(--bg-primary);
          border: 1px solid var(--border-color); border-radius: 8px; min-height: 64px; }
        .tier-label { flex: 0 0 96px; display: flex; flex-direction: column; align-items: center;
          justify-content: center; border-radius: 8px 0 0 8px; color: #fff; padding: 4px; }
        .tier-num { font-size: 1.6rem; font-weight: 800; line-height: 1; }
        .tier-word { font-size: 0.7rem; opacity: 0.9; text-align: center; }
        .tier-cards { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; flex: 1 1 auto; align-content: flex-start; }

        .tray { border: 1px dashed var(--border-color); border-radius: 8px; background: var(--bg-secondary, var(--bg-primary)); margin-top: 6px; }
        .tray-label { padding: 6px 10px; color: var(--text-secondary); font-weight: 600; }

        .thumb-label { display: block; color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 6px; }
        .thumb-buttons { display: flex; gap: 6px; }
        :global(.thumb-active) { outline: 2px solid var(--accent-color, #3b82f6); }
      `}</style>
      <style jsx global>{`
        /* Card rules live here (not in the scoped block) because renderCard is a
           nested helper — styled-jsx only scopes JSX in the component's own
           return, so scoped .card selectors never match these elements. Scoped
           under .board so they don't leak beyond the tier board. */
        .board .card { position: relative; flex: 0 0 auto; border-radius: 4px; overflow: hidden;
          cursor: grab; background: var(--bg-secondary, #222); border: 1px solid transparent; }
        .board .card img { object-fit: cover; display: block; }
        .board .card.dragging { opacity: 0.4; }
        .board .card.failed { border-color: #dc2626; box-shadow: 0 0 0 1px #dc2626; }
        .board .noimg { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
          font-size: 0.7rem; color: var(--text-secondary); }
        .board .badge { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; color: #fff; }
        .board .badge.saving { background: rgba(0,0,0,0.6); }
        .board .badge.fail { background: #dc2626; }
        .board .detail-link { position: absolute; bottom: 2px; right: 2px; width: 16px; height: 16px; border-radius: 4px;
          display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700;
          color: #fff; background: rgba(0,0,0,0.55); text-decoration: none; opacity: 0; transition: opacity 0.12s; }
        .board .card:hover .detail-link { opacity: 1; }
        .board .detail-link:hover { background: var(--accent-primary, #3b82f6); }

        .hover-preview { position: fixed; z-index: 1000; width: 240px; pointer-events: none;
          background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px;
          box-shadow: 0 8px 30px rgba(0,0,0,0.5); overflow: hidden; }
        .hover-preview img { width: 100%; display: block; }
        .hover-title { padding: 6px 8px; font-size: 0.85rem; color: var(--text-primary); }
        .hover-mean { padding: 0 8px 6px; font-size: 0.75rem; color: var(--text-secondary); }
      `}</style>
    </>
  );
}
