/**
 * /boxes — « Mes boîtes », the bulk-labeling grid.
 *
 * A box is a hand-drawn taste axis over the watched list: "what I put on when
 * I'm tired", "I watch this for the animation". The engine cannot infer these —
 * measured on the live store, a set of eight deliberately-weird titles shared
 * exactly one tag beyond `Philosophy` and one T1 credit, because weirdness is a
 * property of form and no catalog field encodes form. So they get recorded by
 * hand, and the payoff is that a box IS an anchor set (see `/boxes/[id]`).
 *
 * This page is the volume path: 712 statused titles collapse to 467 direct-
 * franchise groups, and each carries a chip row for every box. The per-box
 * ranked-proposal loop, which is the FAST path, lives on the detail page.
 *
 * Writes are optimistic and incremental (`add`/`remove`, never a full member
 * replacement) so two quick chip clicks can't clobber each other.
 */
import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { AnimePageLayout } from '@/components/anime';
import { RecoFiltersSection } from '@/components/anime/sidebar';
import { CollapsibleSection } from '@/components/shared';
import BoxChips from '@/components/anime/boxes/BoxChips';
import { useBoxesUrlState, toWatchedGroupsQuery } from '@/hooks';
import { useT } from '@/lib/i18n';
import { DEFAULT_BOX_EMOJI } from '@/models/anime';
import type { BoxListResponse, BoxSummary } from '../api/anime/boxes';
import type { WatchedGroup, WatchedGroupsResponse } from '../api/anime/watched-groups';

export default function BoxesPage() {
  const t = useT();
  const { state, update, isReady } = useBoxesUrlState();

  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [groups, setGroups] = useState<WatchedGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');
  const [creating, setCreating] = useState(false);

  /** `${groupId}:${boxId}` pairs with a write in flight. */
  const [pending, setPending] = useState<Set<string>>(new Set());

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ boxes: true, filters: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const loadBoxes = useCallback(async () => {
    const res = await fetch('/api/anime/boxes');
    if (!res.ok) throw new Error('boxes');
    const data: BoxListResponse = await res.json();
    setBoxes(data.boxes);
  }, []);

  useEffect(() => {
    loadBoxes().catch(() => setError(t('boxes.loadError')));
  }, [loadBoxes, t]);

  const query = isReady ? toWatchedGroupsQuery(state) : null;
  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    setIsLoading(true);
    fetch(`/api/anime/watched-groups?${query}`)
      .then(res => { if (!res.ok) throw new Error('groups'); return res.json(); })
      .then((data: WatchedGroupsResponse) => {
        if (cancelled) return;
        setGroups(data.groups);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .catch(() => { if (!cancelled) setError(t('boxes.loadError')); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [query, t]);

  const createBox = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/anime/boxes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, emoji: newEmoji.trim() || undefined }),
      });
      if (!res.ok) throw new Error('create');
      setNewName('');
      setNewEmoji('');
      await loadBoxes();
    } catch {
      setError(t('boxes.createError'));
    } finally {
      setCreating(false);
    }
  };

  /**
   * File or unfile a whole franchise group. Optimistic, and reverted on failure —
   * the same shape the tier board's score writes use, for the same reason: a chip
   * that lags behind the click makes bulk labeling feel broken.
   */
  const toggleGroup = async (group: WatchedGroup, boxId: string, next: boolean) => {
    const key = `${group.id}:${boxId}`;
    if (pending.has(key)) return;
    const ids = group.members.map(m => m.id);

    setPending(prev => new Set(prev).add(key));
    const before = boxes;
    setBoxes(prev => prev.map(b => {
      if (b.id !== boxId) return b;
      const members = next
        ? [...new Set([...b.members, ...ids])]
        : b.members.filter(m => !ids.includes(m));
      return { ...b, members, count: members.length };
    }));

    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next ? { add: ids } : { remove: ids }),
      });
      if (!res.ok) throw new Error('toggle');
    } catch {
      setBoxes(before);
      setError(t('boxes.saveError'));
    } finally {
      setPending(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const goToPage = (page: number) => {
    update({ page: Math.max(0, Math.min(page, totalPages - 1)) });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  };

  const sidebar = (
    <div className="bx-side" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection
        title={t('boxes.section.boxes')}
        isExpanded={expanded.boxes}
        onToggle={() => toggle('boxes')}
      >
        <p className="hint">{t('boxes.intro')}</p>

        <div className="create">
          {/* Placeholder is the ACTUAL default, not a sample: a field showing an
              emoji you don't get reads as pre-filled, which is exactly how the
              first box here ended up with none. */}
          <input
            className="create-emoji"
            type="text"
            value={newEmoji}
            maxLength={2}
            title={t('boxes.create.emojiTitle')}
            aria-label={t('boxes.create.emojiTitle')}
            placeholder={DEFAULT_BOX_EMOJI}
            onChange={e => setNewEmoji(e.target.value)}
          />
          <input
            className="create-name"
            type="text"
            value={newName}
            placeholder={t('boxes.create.placeholder')}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') createBox(); }}
          />
          <button type="button" onClick={createBox} disabled={!newName.trim() || creating}>
            {t('boxes.create.button')}
          </button>
        </div>

        {boxes.length === 0 ? (
          <p className="hint">{t('boxes.noBoxesHint')}</p>
        ) : (
          <ul className="box-list">
            {boxes.map(box => (
              <li key={box.id}>
                <Link href={`/boxes/${encodeURIComponent(box.id)}`} className="box-link">
                  <span className="box-name">{box.emoji ? `${box.emoji} ` : ''}{box.name}</span>
                  <span className="box-count">{box.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={t('section.filters')}
        isExpanded={expanded.filters}
        onToggle={() => toggle('filters')}
      >
        <p className="hint">{t('boxes.filtersHint')}</p>
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
      </CollapsibleSection>
    </div>
  );

  return (
    <>
      <Head>
        <title>{t('boxes.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="bx-main">
          {error && <div className="error-banner">{error} <button onClick={() => setError('')}>×</button></div>}

          <div className="bx-header">
            <h1 className="bx-title">{t('nav.boxes')}</h1>
            <span className="bx-count">
              {t('boxes.summary', { groups: total })}
              {totalPages > 1 ? ` — ${t('boxes.pageOf', { page: state.page + 1, total: totalPages })}` : ''}
            </span>
          </div>

          {!isReady || isLoading ? (
            <div className="loading-state">{t('common.loading')}</div>
          ) : groups.length === 0 ? (
            <div className="loading-state">{t('boxes.empty')}</div>
          ) : (
            <>
              <div className="bx-groups">
                {groups.map(group => {
                  const memberIds = new Set(group.members.map(m => m.id));
                  // "In the box" = ANY member filed. Toggling writes the whole
                  // group either way, so the two only diverge after a per-title
                  // edit — and then "represented" is the honest reading.
                  const active = new Set(
                    boxes.filter(b => b.members.some(m => memberIds.has(m))).map(b => b.id)
                  );
                  const groupPending = new Set(
                    boxes.map(b => b.id).filter(id => pending.has(`${group.id}:${id}`))
                  );

                  return (
                    <section key={group.id} className="bx-group">
                      <div className="bx-strip">
                        {group.members.map(m => (
                          <Link key={m.id} href={`/anime/${m.id}`} className="bx-poster" title={m.title}>
                            {m.picture
                              ? /* eslint-disable-next-line @next/next/no-img-element */
                                <img src={m.picture} alt={m.title} loading="lazy" />
                              : <span className="bx-noimg">?</span>}
                          </Link>
                        ))}
                      </div>
                      <div className="bx-body">
                        <div className="bx-id">
                          <h2 className="bx-name">{group.title}</h2>
                          <span className="bx-sub">
                            {t(
                              group.members.length > 1 ? 'boxes.memberCount' : 'boxes.memberCountOne',
                              { count: group.members.length }
                            )}
                            {group.score ? ` · ${t('catchUp.yourScore', { score: group.score })}` : ''}
                          </span>
                        </div>
                        <BoxChips
                          boxes={boxes}
                          active={active}
                          pending={groupPending}
                          onToggle={(boxId, next) => toggleGroup(group, boxId, next)}
                          emptyHint={t('boxes.chipsEmptyHint')}
                        />
                      </div>
                    </section>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <nav className="pager">
                  <button type="button" onClick={() => goToPage(state.page - 1)} disabled={state.page === 0}>
                    ← {t('catchUp.prevPage')}
                  </button>
                  <span className="pager-label">
                    {t('boxes.pageOf', { page: state.page + 1, total: totalPages })}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToPage(state.page + 1)}
                    disabled={state.page >= totalPages - 1}
                  >
                    {t('catchUp.nextPage')} →
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      </AnimePageLayout>

      <style jsx>{`
        .bx-main { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .bx-header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
          flex-wrap: wrap; }
        .bx-title { font-size: 1.5rem; margin: 0; color: var(--text-primary); }
        .bx-count { color: var(--text-secondary); font-size: 0.9rem; }
        .loading-state { color: var(--text-secondary); padding: 2rem; text-align: center; }
        .bx-groups { display: flex; flex-direction: column; gap: 0.75rem; }
        .pager { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: 0.5rem 0; }
        .pager button { background: var(--bg-tertiary); color: var(--text-primary);
          border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 14px; cursor: pointer; }
        .pager button:disabled { opacity: 0.4; cursor: default; }
        .pager-label { color: var(--text-secondary); font-size: 0.85rem; }
      `}</style>

      <style jsx global>{`
        /* Descendant chains live here rather than in the scoped block above:
           styled-jsx suffixes EVERY compound in a chain, so a two-class
           descendant selector stops matching the moment any of that markup moves
           into a helper. Every selector is prefixed with .bx-main, so "global"
           stays page-local — the same split catch-up.tsx and tier.tsx use, and
           the reason both carry two blocks.
           No backticks in these comments: this is a template literal. */
        .bx-main .bx-group { display: flex; gap: 12px; padding: 10px; border-radius: 8px;
          background: var(--bg-secondary); border: 1px solid var(--border-color); }
        .bx-main .bx-strip { display: flex; gap: 6px; flex-shrink: 0; }
        .bx-main .bx-poster { display: block; width: 62px; aspect-ratio: 2 / 3; border-radius: 4px;
          overflow: hidden; border: 1px solid var(--border-color); background: var(--bg-tertiary); }
        .bx-main .bx-poster:hover { border-color: var(--accent-primary); }
        .bx-main .bx-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .bx-main .bx-noimg { display: flex; width: 100%; height: 100%; align-items: center;
          justify-content: center; color: var(--text-muted); font-size: 0.8rem; }
        .bx-main .bx-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; flex: 1; }
        .bx-main .bx-id { display: flex; flex-direction: column; gap: 2px; }
        .bx-main .bx-name { margin: 0; font-size: 1rem; color: var(--text-primary); line-height: 1.25; }
        .bx-main .bx-sub { color: var(--text-muted); font-size: 0.76rem; }

        /* ⚠️ The sidebar is held in a hoisted const, so styled-jsx does NOT put
           its scope class on that markup and a rule for it in the block above
           would silently do nothing. Prefixed with .bx-side, which is what keeps
           these "global" rules page-local.
           ⚠️ No backticks in these comments — this is a template literal. */
        .bx-side .hint { color: var(--text-muted); font-size: 0.8rem; margin: 0 0 0.5rem; line-height: 1.4; }
        .bx-side .create { display: flex; gap: 6px; margin-bottom: 0.75rem; }
        .bx-side .create-emoji { width: 46px; text-align: center; }
        .bx-side .create-name { flex: 1; min-width: 0; }
        .bx-side .create input { background: var(--bg-tertiary); color: var(--text-primary);
          border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 8px; font-size: 0.85rem; }
        .bx-side .create button { background: var(--accent-primary); color: #fff; border: none;
          border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 0.85rem; white-space: nowrap; }
        .bx-side .create button:disabled { opacity: 0.4; cursor: default; }
        .bx-side .box-list { list-style: none; margin: 0; padding: 0; display: flex;
          flex-direction: column; gap: 4px; }
        .bx-side .box-link { display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 6px 8px; border-radius: 6px; background: var(--bg-tertiary);
          color: var(--text-primary); text-decoration: none; font-size: 0.85rem; }
        .bx-side .box-link:hover { background: var(--bg-secondary); color: var(--accent-primary); }
        .bx-side .box-count { color: var(--text-muted); font-size: 0.78rem; }
      `}</style>
    </>
  );
}
