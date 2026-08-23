import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { AnimePageLayout, AnimeListHeader } from '@/components/anime';
import { RecoFiltersSection } from '@/components/anime/sidebar';
import SeasonFilter from '@/components/anime/SeasonFilter';
import filterStyles from '@/components/anime/sidebar/RecoFiltersSection.module.css';
import { Button, CollapsibleSection } from '@/components/shared';
import { AnimeRecord, ImageSize } from '@/models/anime';
import { applyNarrowingFilters, getEffectiveScore, getEffectiveStatus, getPrimaryTitle } from '@/lib/domain/animeUtils';
import {
  GAP_MAX, GAP_ROWS, TIER_SCORES, TIER_STATUSES,
  clampGapRow, gapOf as computeGap, meanRow, providerMeans,
} from '@/lib/domain/tierGap';
import { useTierUrlState } from '@/hooks';
import type { TierAxis, TierVersus } from '@/hooks/useTierUrlState';
import { useT, TranslationKey } from '@/lib/i18n';

// The rows, the gap arithmetic and the board's status scope live in
// `domain/tierGap.ts`, shared with the MCP `tier_list` tool so the two cannot
// disagree about which mean is compared. Scores 10→1 carry MAL's word labels
// (localized via `tierWord.<n>`); gap labels are `tierGap.<p5…p1|zero|m1…m5>`, a
// dynamic key family, so keep it exhaustive by hand (see CLAUDE.md's i18n note).

const AXES: readonly TierAxis[] = ['me', 'mal', 'anilist', 'gap'];
const VERSUS: readonly TierVersus[] = ['none', 'mal', 'anilist'];

function gapKey(d: number): TranslationKey {
  const suffix = d === 0 ? 'zero' : d > 0 ? `p${d}` : `m${-d}`;
  return `tierGap.${suffix}` as TranslationKey;
}

// Blue when I rate above the crowd, amber when below, neutral when we agree —
// the same encoding the per-card chip uses, so a chip predicts its gap row.
function gapColor(d: number): string {
  if (d === 0) return 'var(--bg-secondary, #33373d)';
  const strength = Math.min(Math.abs(d), GAP_MAX) / GAP_MAX;
  const light = 30 + Math.round(strength * 22);
  return d > 0 ? `hsl(213, 60%, ${light}%)` : `hsl(32, 62%, ${light}%)`;
}


// green (10) → red (1)
function scoreColor(n: number): string {
  return `hsl(${Math.round(((n - 1) / 9) * 120)}, 55%, 42%)`;
}

const THUMB_W: Record<ImageSize, number> = { 0: 46, 1: 62, 2: 84, 3: 112 };
const THUMB_LABELS: Record<ImageSize, string> = { 0: 'S', 1: 'M', 2: 'L', 3: 'XL' };
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

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ filters: true });
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

  // Community means, per provider, RAW rather than merged — see `providerMeans`
  // for why `catalog.mean` is the wrong number to compare against.
  const meansById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof providerMeans>>();
    for (const a of animes) m.set(a.id, providerMeans(a));
    return m;
  }, [animes]);

  // `gap` has to compare against something, so `vs: 'none'` falls back to MAL
  // there rather than emptying the board. On the other axes `none` just hides
  // the chip, and `vsProvider` goes unused.
  const vsProvider: 'mal' | 'anilist' = state.vs === 'anilist' ? 'anilist' : 'mal';
  const showChip = state.vs !== 'none' && state.by !== 'gap';

  /** My score minus the comparison provider's rounded mean; null if either is missing. */
  const gapOf = useCallback(
    (id: string): number | null => computeGap(effScoreOf(id), meansById.get(id)?.[vsProvider] ?? null),
    [effScoreOf, meansById, vsProvider],
  );

  /** Which row a card lands in on the active axis; null sends it to the tray. */
  const rowOf = useCallback((id: string): number | null => {
    if (state.by === 'me') {
      const s = effScoreOf(id);
      return s > 0 ? s : null;
    }
    if (state.by === 'gap') {
      const d = gapOf(id);
      return d === null ? null : clampGapRow(d);
    }
    const mean = meansById.get(id)?.[state.by === 'anilist' ? 'anilist' : 'mal'];
    return mean == null ? null : meanRow(mean);
  }, [state.by, effScoreOf, gapOf, meansById]);

  // Only my own scores are writable — a community mean and a difference are both
  // readings, not settings, so those axes drop the drag affordance entirely.
  const readOnly = state.by !== 'me';
  const rows = state.by === 'gap' ? GAP_ROWS : TIER_SCORES;

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
    if (state.seasons.length > 0) {
      const wanted = new Set(state.seasons.map(s => `${s.year}-${s.season}`));
      out = out.filter(a => {
        const ss = a.catalog.startSeason;
        return !!ss && wanted.has(`${ss.year}-${ss.season}`);
      });
    }
    return out;
  }, [animes, state.search, state.mediaTypes, state.minScore, state.maxScore, state.minYear, state.maxYear, state.genres, state.statuses, state.seasons]);

  // Distinct MAL genre names (not AniList tags) across the loaded list, alphabetized.
  const availableGenres = useMemo(() => {
    const names = new Set<string>();
    for (const a of animes) for (const g of a.catalog.genres || []) names.add(g.name);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [animes]);

  // Bucket the filtered list onto the active axis; whatever has no value there
  // falls to the tray. On the `me` axis that means unrated titles, and unrated
  // `watching` ones DO land there: rating mid-watch is a legitimate verdict
  // ("I'm 8 episodes in and it's an 8"), and excluding them made the board
  // render empty whenever the status filter was narrowed to En Cours alone.
  // On a provider axis it means "that provider has no mean for this title",
  // and on `gap` it means either side is missing. Dropping into a row is
  // score-only — status is untouched.
  //
  // Within a row, cards sort by gap descending when the chip is on, so the
  // titles you disagree with the crowd about cluster at one end; alphabetical
  // otherwise (and as the tiebreak).
  const board = useMemo(() => {
    const byRow = new Map<number, AnimeRecord[]>();
    for (const r of rows) byRow.set(r, []);
    const tray: AnimeRecord[] = [];
    for (const a of filtered) {
      const r = rowOf(a.id);
      if (r === null || !byRow.has(r)) tray.push(a);
      else byRow.get(r)!.push(a);
    }
    const cmp = (a: AnimeRecord, c: AnimeRecord) => {
      if (showChip) {
        const ga = gapOf(a.id);
        const gc = gapOf(c.id);
        if (ga !== gc) {
          if (ga === null) return 1;
          if (gc === null) return -1;
          return gc - ga;
        }
      }
      return getPrimaryTitle(a).localeCompare(getPrimaryTitle(c));
    };
    for (const list of byRow.values()) list.sort(cmp);
    tray.sort((a, c) => getPrimaryTitle(a).localeCompare(getPrimaryTitle(c)));
    return { byRow, tray };
  }, [filtered, rows, rowOf, showChip, gapOf]);

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

  const placedCount = useMemo(() => filtered.length - board.tray.length, [filtered, board]);

  const renderCard = (a: AnimeRecord) => {
    const thumb = a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large || '';
    const isSaving = saving.has(a.id);
    const fail = failed.get(a.id);
    const gap = showChip ? gapOf(a.id) : null;
    return (
      <div
        key={a.id}
        className={`card ${draggingId === a.id ? 'dragging' : ''} ${fail ? 'failed' : ''} ${readOnly ? 'readonly' : ''}`}
        draggable={!readOnly}
        onDragStart={readOnly ? undefined : (e) => onDragStart(e, a.id)}
        onDragEnd={readOnly ? undefined : onDragEnd}
        onMouseEnter={(e) => onCardEnter(e, a)}
        onMouseLeave={onCardLeave}
        title={getPrimaryTitle(a)}
        style={{ width: thumbW, height: thumbH }}
      >
        {thumb
          ? <img src={thumb} alt="" loading="lazy" draggable={false} style={{ width: '100%', height: '100%' }} />
          : <div className="noimg">{getPrimaryTitle(a).slice(0, 2)}</div>}
        {gap !== null && (
          <span
            className={`gap-chip ${gap > 0 ? 'gap-up' : gap < 0 ? 'gap-down' : 'gap-eq'}`}
            title={t('tier.gapChipHint', { provider: vsProvider === 'anilist' ? 'AniList' : 'MAL' })}
          >{gap === 0 ? '=' : gap > 0 ? `+${gap}` : `−${-gap}`}</span>
        )}
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

        <div className={filterStyles.fieldGroup}>
          <label className={filterStyles.label}>{t('filters.season')}</label>
          <SeasonFilter value={state.seasons} onChange={(seasons) => update({ seasons })} />
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

          {/* The same bar `/` and `/recommendations` render — these are all
              "how the board looks" controls, so they belong next to the board
              rather than in the sidebar, which answers *which* anime.
              No `display` slot: the rows are wrapped thumbnails, not a card
              grid, so cards-per-row means nothing here — thumbnail size is
              this page's equivalent and rides in as a child. */}
          <AnimeListHeader
            title={t('nav.tierList')}
            count={state.by === 'me'
              ? t('tier.headerCount', { rated: placedCount, toRate: board.tray.length })
              : t('tier.headerCountRead', { placed: placedCount, missing: board.tray.length })}
          >
            <div className="hdr-group">
              <span className="hdr-label">{t('tier.axisLabel')}</span>
              {AXES.map(a => (
                <Button
                  key={a}
                  variant="secondary"
                  size="xs"
                  className={state.by === a ? 'thumb-active' : ''}
                  onClick={() => update({ by: a })}
                >
                  {t(`tier.axis.${a}` as TranslationKey)}
                </Button>
              ))}
            </div>

            <div className="hdr-group">
              <span className="hdr-label">{t('tier.vsLabel')}</span>
              {(state.by === 'gap' ? VERSUS.filter(v => v !== 'none') : VERSUS).map(v => (
                <Button
                  key={v}
                  variant="secondary"
                  size="xs"
                  className={(state.by === 'gap' ? vsProvider : state.vs) === v ? 'thumb-active' : ''}
                  onClick={() => update({ vs: v })}
                >
                  {t(`tier.vs.${v}` as TranslationKey)}
                </Button>
              ))}
            </div>

            {/* Icon + dropdown rather than a label and four buttons: this is the
                header's least-used group and it was costing ~200px on a bar that
                already wraps at the TV target. The label survives as the icon's
                tooltip and the select's aria-label, so it is still named. */}
            <div className="hdr-group">
              <span className="hdr-icon" title={t('section.thumbnailSize')} aria-hidden="true">🖼</span>
              <select
                className="hdr-select"
                aria-label={t('section.thumbnailSize')}
                value={state.thumbSize}
                onChange={(e) => update({ thumbSize: parseInt(e.target.value, 10) as ImageSize })}
              >
                {([0, 1, 2, 3] as ImageSize[]).map(s => (
                  <option key={s} value={s}>{THUMB_LABELS[s]}</option>
                ))}
              </select>
            </div>

            {readOnly && <span className="hdr-note">{t('tier.readOnlyNote')}</span>}
          </AnimeListHeader>

          {!isReady || isLoading ? (
            <div className="loading-state">{t('common.loading')}</div>
          ) : (
            <div className="board">
              {rows.map(r => (
                <div
                  key={r}
                  className="tier-row"
                  onDragOver={readOnly ? undefined : allowDrop}
                  onDrop={readOnly ? undefined : (e) => onDropTo(e, r)}
                >
                  <div
                    className={`tier-label ${state.by === 'gap' ? 'wide' : ''}`}
                    style={{ background: state.by === 'gap' ? gapColor(r) : scoreColor(r) }}
                  >
                    <span className="tier-num">
                      {state.by === 'gap' ? (r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0') : r}
                    </span>
                    <span className="tier-word">
                      {t(state.by === 'gap' ? gapKey(r) : (`tierWord.${r}` as TranslationKey))}
                    </span>
                  </div>
                  <div className="tier-cards">
                    {board.byRow.get(r)!.map(renderCard)}
                  </div>
                </div>
              ))}

              <div className="tray" onDragOver={readOnly ? undefined : allowDrop} onDrop={readOnly ? undefined : (e) => onDropTo(e, 0)}>
                <div className="tray-label">
                  {state.by === 'me'
                    ? t('tier.trayLabel', { count: board.tray.length })
                    : t('tier.trayLabelRead', { count: board.tray.length })}
                </div>
                <div className="tier-cards">
                  {board.tray.map(renderCard)}
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
          <div className="hover-mean">
            {[
              meansById.get(preview.anime.id)?.mal != null ? `MAL ${meansById.get(preview.anime.id)!.mal!.toFixed(2)}` : null,
              meansById.get(preview.anime.id)?.anilist != null ? `AniList ${meansById.get(preview.anime.id)!.anilist!.toFixed(2)}` : null,
              effScoreOf(preview.anime.id) > 0 ? t('tier.hoverMine', { score: effScoreOf(preview.anime.id) }) : null,
            ].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
      )}

      <style jsx>{`
        .tier-main { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        /* Header children: one group each, shaped like DisplaySection's inline
           variant (nowrap label + controls) so they sit flush with the shared
           groups on the main list and the reco feed. NOTE: no backticks in here
           — this whole block is a template literal, and one would end it. */
        .hdr-group { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
        .hdr-label { font-weight: 600; color: var(--text-primary); font-size: 0.9rem; white-space: nowrap; }
        .hdr-note { color: var(--text-secondary); font-size: 0.8rem; font-style: italic; }
        .hdr-icon { font-size: 1rem; line-height: 1; cursor: default; }
        /* Matches SortOrderSection's inline .select so the two read as one bar. */
        .hdr-select { padding: 5px 8px; background: var(--bg-secondary); color: var(--text-primary);
          border: 1px solid #444; border-radius: 4px; font-size: 0.9rem; cursor: pointer; }
        .hdr-select:hover, .hdr-select:focus { outline: none; border-color: var(--accent-primary); }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }

        .board { display: flex; flex-direction: column; gap: 6px; }
        .tier-row { display: flex; align-items: stretch; gap: 8px; background: var(--bg-primary);
          border: 1px solid var(--border-color); border-radius: 8px; min-height: 64px; }
        .tier-label { flex: 0 0 96px; display: flex; flex-direction: column; align-items: center;
          justify-content: center; border-radius: 8px 0 0 8px; color: #fff; padding: 4px; }
        .tier-label.wide { flex: 0 0 132px; }
        .tier-num { font-size: 1.6rem; font-weight: 800; line-height: 1; }
        .tier-word { font-size: 0.7rem; opacity: 0.9; text-align: center; }
        .tier-cards { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; flex: 1 1 auto; align-content: flex-start; }

        .tray { border: 1px dashed var(--border-color); border-radius: 8px; background: var(--bg-secondary, var(--bg-primary)); margin-top: 6px; }
        .tray-label { padding: 6px 10px; color: var(--text-secondary); font-weight: 600; }

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
        .board .card.readonly { cursor: default; }

        /* Gap chip sits top-LEFT: top-right is taken by the saving/failure badge.
           Blue = I rate above the crowd, amber = below, neutral = we agree. */
        .board .gap-chip { position: absolute; top: 2px; left: 2px; min-width: 17px; height: 15px;
          padding: 0 3px; border-radius: 8px; font-size: 0.65rem; line-height: 15px; text-align: center;
          font-weight: 700; pointer-events: none; }
        .board .gap-up { background: #bfdbfe; color: #1e3a5f; }
        .board .gap-down { background: #fde3b8; color: #663d0a; }
        .board .gap-eq { background: rgba(0,0,0,0.55); color: #d4d4d8; }
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
