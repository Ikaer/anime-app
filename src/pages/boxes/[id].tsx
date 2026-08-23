/**
 * /boxes/[id] — one box, three views.
 *
 *  - **remplir** (`v` absent) — the FAST path. `rankBoxCandidates` ranks the
 *    owner's own watched list by resemblance to the box, franchise-grouped, and
 *    each row states the values that earned it ("Lost Civilization · Travel ·
 *    Steampunk"). That is what turns 467 groups of scrolling into ~40 decisions,
 *    most of them yes. Accepting re-ranks the tail.
 *  - **membres** — the audit grid. Coherence is comparative: you cannot tell the
 *    one that doesn't belong without seeing the box at once.
 *  - **recos** — the payoff, and the reason `members` is stored as a flat id
 *    array: a box IS an anchor set, so this is `/mix` pointed at it, ranked by
 *    the same `computeAnchored`.
 *
 * ⚠️ The grow ranker is metadata-only, so how well it works depends on the box.
 * Measured during design: a content axis (Steampunk / Lost Civilization /
 * Aviation) proposes beautifully; a FORM axis — "weird" — does not, because no
 * catalog field encodes form, and its 8-title probe drifted to Death Note and
 * Monster. For those boxes the recos tab is the answer: the crowd graph encodes
 * tone even though no field does. Neither tab is a fallback for the other.
 */
import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { AnimePageLayout, AnimeCardView } from '@/components/anime';
import { CollapsibleSection } from '@/components/shared';
import MixAnchorsSection from '@/components/anime/sidebar/MixAnchorsSection';
import { useBoxUrlState } from '@/hooks';
import { useT, TranslationKey } from '@/lib/i18n';
import type { BoxListResponse, BoxSummary } from '../api/anime/boxes';
import type { GrowGroup, GrowResponse } from '../api/anime/boxes/[id]/grow';
import type { BoxMembersResponse } from '../api/anime/boxes/[id]/members';
import type { LeanAnimeRow } from '@/lib/domain/leanRow';
import { DEFAULT_BOX_EMOJI, type AnimeRecord, type RecoMeta } from '@/models/anime';

type FeedCard = AnimeRecord & { recoMeta: RecoMeta };

export default function BoxDetailPage() {
  const t = useT();
  const { boxId, state, update, isReady } = useBoxUrlState();

  const [box, setBox] = useState<BoxSummary | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');

  const [groups, setGroups] = useState<GrowGroup[]>([]);
  const [members, setMembers] = useState<LeanAnimeRow[]>([]);
  const [feed, setFeed] = useState<FeedCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  /**
   * Groups passed over this session. Client-only on purpose: a skip means "not
   * now", so a box you come back to offers them again rather than narrowing
   * forever — and persisting it would be a second membership file to keep in
   * step with the first.
   */
  const [skipped, setSkipped] = useState<string[]>([]);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ seeds: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const loadBox = useCallback(async () => {
    const res = await fetch('/api/anime/boxes');
    if (!res.ok) throw new Error('boxes');
    const data: BoxListResponse = await res.json();
    const found = data.boxes.find(b => b.id === boxId);
    if (!found) { setNotFound(true); return null; }
    setBox(found);
    return found;
  }, [boxId]);

  useEffect(() => {
    if (!isReady || !boxId) return;
    loadBox().catch(() => setError(t('boxes.loadError')));
  }, [isReady, boxId, loadBox, t]);

  // The three views each own their fetch. `box?.members.join()` is in the deps
  // so every membership change refetches — accepting a proposal must re-rank the
  // tail, and the members grid must reflect a removal immediately.
  const memberKey = box?.members.join(',') ?? null;
  useEffect(() => {
    if (!isReady || !boxId || memberKey === null) return;
    let cancelled = false;
    setIsLoading(true);

    // `members` is served by the effect below, which runs on every view.
    if (state.view === 'members') { setIsLoading(false); return; }

    const url =
      state.view === 'grow'
        ? `/api/anime/boxes/${encodeURIComponent(boxId)}/grow?skip=${skipped.join(',')}`
        : `/api/anime/recommendations/mix?box=${encodeURIComponent(boxId)}` +
          (state.includeSeen ? '&includeSeen=true' : '');

    fetch(url)
      .then(res => { if (!res.ok) throw new Error('view'); return res.json(); })
      .then((data: GrowResponse | { animes: FeedCard[] }) => {
        if (cancelled) return;
        if (state.view === 'grow') setGroups((data as GrowResponse).groups);
        else if (state.view === 'feed') setFeed((data as { animes: FeedCard[] }).animes || []);
      })
      .catch(() => { if (!cancelled) setError(t('boxes.loadError')); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [isReady, boxId, state.view, state.includeSeen, memberKey, skipped, t]);

  // Members resolved to titles + posters. Loaded on EVERY view, not just the
  // audit grid: the sidebar's seed chips render from the same list, and showing
  // raw canonical ids there would make the one control that removes a seed
  // unusable.
  useEffect(() => {
    if (!isReady || !boxId || memberKey === null) return;
    if (memberKey === '') { setMembers([]); return; }
    let cancelled = false;
    fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}/members`)
      .then(res => { if (!res.ok) throw new Error('members'); return res.json(); })
      .then((data: BoxMembersResponse) => { if (!cancelled) setMembers(data.members); })
      .catch(() => { if (!cancelled) setError(t('boxes.loadError')); });
    return () => { cancelled = true; };
  }, [isReady, boxId, memberKey, t]);

  const writeMembers = async (body: Record<string, string[]>, key: string) => {
    if (busy.has(key)) return;
    setBusy(prev => new Set(prev).add(key));
    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('write');
      await loadBox();
    } catch {
      setError(t('boxes.saveError'));
    } finally {
      setBusy(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const accept = (group: GrowGroup) =>
    writeMembers({ add: group.members.map(m => m.id) }, group.id);
  const removeMember = (id: string) => writeMembers({ remove: [id] }, id);
  const addSeed = (id: string) => writeMembers({ add: [id] }, id);

  const patchBox = async (patch: { name?: string; emoji?: string }) => {
    await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadBox();
  };

  const renameBox = async () => {
    if (!box) return;
    const name = typeof window !== 'undefined' ? window.prompt(t('boxes.renamePrompt'), box.name) : null;
    if (!name || !name.trim()) return;
    await patchBox({ name: name.trim() });
  };

  const deleteBox = async () => {
    if (typeof window !== 'undefined' && !window.confirm(t('boxes.deleteConfirm'))) return;
    await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, { method: 'DELETE' });
    window.location.href = '/boxes';
  };

  const sidebar = (
    <div className="bd-side" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection
        title={t('boxes.section.seeds')}
        isExpanded={expanded.seeds}
        onToggle={() => toggle('seeds')}
      >
        <p className="hint">{t('boxes.seedsHint')}</p>
        <MixAnchorsSection
          anchors={members.map(m => ({ id: m.id, title: m.title, poster: m.picture }))}
          onAdd={addSeed}
          onRemove={removeMember}
          max={Number.MAX_SAFE_INTEGER}
        />
      </CollapsibleSection>

      <div className="bd-actions">
        <button type="button" onClick={renameBox}>{t('boxes.rename')}</button>
        <button type="button" className="danger" onClick={deleteBox}>{t('boxes.delete')}</button>
      </div>
    </div>
  );

  const views: { key: typeof state.view; label: TranslationKey }[] = [
    { key: 'grow', label: 'boxes.view.grow' },
    { key: 'members', label: 'boxes.view.members' },
    { key: 'feed', label: 'boxes.view.feed' },
  ];

  return (
    <>
      <Head>
        <title>{box ? `${box.name} — ${t('nav.boxes')}` : t('boxes.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="bd-main">
          {error && <div className="error-banner">{error} <button onClick={() => setError('')}>×</button></div>}

          <div className="bd-header">
            <div className="bd-id">
              <Link href="/boxes" className="bd-back">← {t('nav.boxes')}</Link>
              <h1 className="bd-title">
                {/* Editable in place: an emoji picked at create time was the only
                    way to get one, so a box made without it was stuck that way. */}
                <input
                  className="bd-emoji"
                  type="text"
                  maxLength={2}
                  defaultValue={box?.emoji ?? DEFAULT_BOX_EMOJI}
                  key={box?.emoji ?? boxId}
                  title={t('boxes.emojiTitle')}
                  aria-label={t('boxes.emojiTitle')}
                  onBlur={e => {
                    const next = e.target.value.trim() || DEFAULT_BOX_EMOJI;
                    if (box && next !== box.emoji) patchBox({ emoji: next });
                  }}
                />
                {box?.name ?? boxId}
              </h1>
              <span className="bd-sub">
                {t(
                  (box?.count ?? 0) > 1 ? 'boxes.memberCount' : 'boxes.memberCountOne',
                  { count: box?.count ?? 0 }
                )}
              </span>
            </div>
            <div className="bd-tabs">
              {views.map(v => (
                <button
                  key={v.key}
                  type="button"
                  className={state.view === v.key ? 'bd-tab on' : 'bd-tab'}
                  onClick={() => update({ view: v.key })}
                >
                  {t(v.label)}
                </button>
              ))}
            </div>
          </div>

          {notFound ? (
            <div className="loading-state">{t('boxes.notFound')}</div>
          ) : !isReady || isLoading ? (
            <div className="loading-state">{t('common.loading')}</div>
          ) : state.view === 'grow' ? (
            (box?.count ?? 0) === 0 ? (
              <div className="loading-state">{t('boxes.grow.needSeeds')}</div>
            ) : groups.length === 0 ? (
              <div className="loading-state">{t('boxes.grow.empty')}</div>
            ) : (
              <div className="bd-rows">
                {groups.map(g => (
                  <section key={g.id} className="bd-row">
                    <div className="bd-strip">
                      {g.members.map(m => (
                        <Link key={m.id} href={`/anime/${m.id}`} className="bd-poster" title={m.title}>
                          {m.picture
                            ? /* eslint-disable-next-line @next/next/no-img-element */
                              <img src={m.picture} alt={m.title} loading="lazy" />
                            : <span className="bd-noimg">?</span>}
                        </Link>
                      ))}
                    </div>
                    <div className="bd-body">
                      <h2 className="bd-name">{g.members[0]?.title ?? g.id}</h2>
                      <div className="bd-why">
                        {g.matched.map(m => (
                          <span key={m.field} className="bd-match">
                            <span className="bd-field">{t(`reco.source.${m.field}.label` as TranslationKey)}</span>
                            {m.values.join(' · ')}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="bd-choice">
                      <button
                        type="button"
                        className="accept"
                        disabled={busy.has(g.id)}
                        onClick={() => accept(g)}
                      >
                        {t('boxes.grow.add')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSkipped(prev => [...prev, g.id])}
                      >
                        {t('boxes.grow.skip')}
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            )
          ) : state.view === 'members' ? (
            members.length === 0 ? (
              <div className="loading-state">{t('boxes.members.empty')}</div>
            ) : (
              <div className="bd-grid">
                {members.map(m => (
                  <div key={m.id} className="bd-card">
                    <Link href={`/anime/${m.id}`} className="bd-poster" title={m.title}>
                      {m.picture
                        ? /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={m.picture} alt={m.title} loading="lazy" />
                        : <span className="bd-noimg">?</span>}
                    </Link>
                    <span className="bd-card-title">{m.title}</span>
                    <button
                      type="button"
                      className="bd-remove"
                      disabled={busy.has(m.id)}
                      onClick={() => removeMember(m.id)}
                    >
                      {t('boxes.members.remove')}
                    </button>
                  </div>
                ))}
              </div>
            )
          ) : (
            <>
              <label className="bd-seen">
                <input
                  type="checkbox"
                  checked={state.includeSeen}
                  onChange={e => update({ includeSeen: e.target.checked })}
                /> {t('boxes.feed.includeSeen')}
              </label>
              {feed.length === 0 ? (
                <div className="loading-state">{t('boxes.feed.empty')}</div>
              ) : (
                // The same card as /mix and /recommendations, deliberately: it
                // already honours the title-language preference and renders the
                // "Pourquoi ?" breakdown this feed ships. Hand-rolling a poster
                // grid here would have been the app's one un-threaded title call
                // site, and that is a bug that does not announce itself.
                <AnimeCardView animes={feed} cardsPerRow={state.cardsPerRow} feedbackMode={null} />
              )}
            </>
          )}
        </div>
      </AnimePageLayout>

      <style jsx>{`
        .bd-main { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .bd-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem;
          flex-wrap: wrap; }
        .loading-state { color: var(--text-secondary); padding: 2rem; text-align: center; }
      `}</style>

      <style jsx global>{`
        /* Descendant chains and hoisted-const markup both live here — styled-jsx
           suffixes every compound in a chain and never touches JSX held in a
           const, so a rule for either in the scoped block would silently do
           nothing. Prefixed with .bd-main / .bd-side to stay page-local.
           No backticks in these comments: this is a template literal. */
        .bd-main .bd-id { display: flex; flex-direction: column; gap: 2px; }
        .bd-main .bd-back { color: var(--text-muted); font-size: 0.8rem; text-decoration: none; }
        .bd-main .bd-back:hover { color: var(--accent-primary); }
        .bd-main .bd-title { font-size: 1.5rem; margin: 0; color: var(--text-primary);
          display: flex; align-items: center; gap: 8px; }
        .bd-main .bd-emoji { width: 1.8em; padding: 2px 0; text-align: center; font-size: 1em;
          line-height: 1; background: transparent; color: inherit; border: 1px solid transparent;
          border-radius: 6px; cursor: pointer; }
        .bd-main .bd-emoji:hover { border-color: var(--border-hover); }
        .bd-main .bd-emoji:focus { outline: none; border-color: var(--accent-primary);
          background: var(--bg-tertiary); cursor: text; }
        .bd-main .bd-sub { color: var(--text-secondary); font-size: 0.85rem; }
        .bd-main .bd-tabs { display: flex; gap: 6px; }
        .bd-main .bd-tab { background: var(--bg-tertiary); color: var(--text-secondary);
          border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 14px;
          cursor: pointer; font-size: 0.85rem; }
        .bd-main .bd-tab:hover { color: var(--text-primary); border-color: var(--border-hover); }
        .bd-main .bd-tab.on { background: var(--accent-primary); border-color: var(--accent-primary);
          color: #fff; }

        .bd-main .bd-rows { display: flex; flex-direction: column; gap: 0.6rem; }
        .bd-main .bd-row { display: flex; gap: 12px; align-items: center; padding: 10px;
          border-radius: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); }
        .bd-main .bd-strip { display: flex; gap: 6px; flex-shrink: 0; }
        .bd-main .bd-poster { display: block; width: 58px; aspect-ratio: 2 / 3; border-radius: 4px;
          overflow: hidden; border: 1px solid var(--border-color); background: var(--bg-tertiary); }
        .bd-main .bd-poster:hover { border-color: var(--accent-primary); }
        .bd-main .bd-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .bd-main .bd-noimg { display: flex; width: 100%; height: 100%; align-items: center;
          justify-content: center; color: var(--text-muted); font-size: 0.8rem; }
        .bd-main .bd-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
        .bd-main .bd-name { margin: 0; font-size: 1rem; color: var(--text-primary); line-height: 1.25; }
        .bd-main .bd-why { display: flex; flex-direction: column; gap: 2px; }
        .bd-main .bd-match { color: var(--text-secondary); font-size: 0.78rem; }
        .bd-main .bd-field { color: var(--text-muted); margin-right: 6px; }
        .bd-main .bd-choice { display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
        .bd-main .bd-choice button { background: var(--bg-tertiary); color: var(--text-primary);
          border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 16px;
          cursor: pointer; font-size: 0.85rem; }
        .bd-main .bd-choice button:disabled { opacity: 0.4; cursor: default; }
        .bd-main .bd-choice .accept { background: var(--accent-primary); border-color: var(--accent-primary);
          color: #fff; }

        .bd-main .bd-grid { display: grid; gap: 10px;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
        .bd-main .bd-card { display: flex; flex-direction: column; gap: 4px; }
        .bd-main .bd-card .bd-poster { width: 100%; }
        .bd-main .bd-card-title { color: var(--text-primary); font-size: 0.78rem; line-height: 1.25; }
        .bd-main .bd-remove { background: var(--bg-tertiary); color: var(--text-secondary);
          border: 1px solid var(--border-color); border-radius: 6px; padding: 3px 8px;
          cursor: pointer; font-size: 0.72rem; }
        .bd-main .bd-remove:hover:not(:disabled) { color: #f87171; border-color: #f87171; }
        .bd-main .bd-seen { display: flex; align-items: center; gap: 6px;
          color: var(--text-secondary); font-size: 0.85rem; }

        .bd-side .hint { color: var(--text-muted); font-size: 0.8rem; margin: 0 0 0.5rem;
          line-height: 1.4; }
        .bd-side .bd-actions { display: flex; gap: 6px; }
        .bd-side .bd-actions button { flex: 1; background: var(--bg-tertiary); color: var(--text-primary);
          border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px;
          cursor: pointer; font-size: 0.82rem; }
        .bd-side .bd-actions .danger:hover { color: #f87171; border-color: #f87171; }
      `}</style>
    </>
  );
}
