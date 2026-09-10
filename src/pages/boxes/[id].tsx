/**
 * /boxes/[id] — one box.
 *
 * Tabs: **présentation** (default), **recos**, **écartés**. Quick-edit is a MODE
 * on présentation rather than a fourth tab — "what is this box" stays the page's
 * answer, and filling it is something you do to that answer (§6.2).
 *
 * What présentation adds over the landing card is the whole reason it is not
 * just a longer card: **« De quoi cette boîte est faite »**. Shared tags,
 * studios, T1 staff and the score/year ranges are free — every input is already
 * on the record — and they are the honest answer to "what did I actually draw
 * here". They also say, before any ranked list is trusted, whether this is a
 * CONTENT axis (it will project) or a FORM axis (it will not, because no catalog
 * field encodes form, and the recos tab is what fills it instead).
 *
 * ⚠️ **Écartés renders from ids alone and is never joined against the watched
 * list** (§3). The recos tab surfaces unseen candidates and « Non » files them
 * here, so this list contains unwatched titles by construction — joining it
 * against what the owner has seen is the failure shape that made a seiyuu
 * filmography return only already-watched titles.
 *
 * It was built alongside the page it replaces and swapped over it in one commit
 * (§2), so nothing here ever had to keep the old three-view page working.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AnimePicker from '@/components/anime/AnimePicker';
import BoxEntryList from '@/components/anime/boxes/BoxEntryList';
import BoxCompositionBlock from '@/components/anime/boxes/BoxCompositionBlock';
import QuickEdit from '@/components/anime/boxes/QuickEdit';
import BoxRecos from '@/components/anime/boxes/BoxRecos';
import { useBoxUrlState, type BoxTab } from '@/hooks';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { BoxMembersResponse } from '../api/anime/boxes/[id]/members';

/**
 * The reload throttle's window. Long enough to swallow a run of clicks, short
 * enough that the header counts settle while you are still looking at the pane.
 */
const RELOAD_DEBOUNCE_MS = 400;

export default function BoxV2DetailPage() {
  const t = useT();
  const { boxId, state, update, setCardsPerRow, isReady } = useBoxUrlState();

  const [data, setData] = useState<BoxMembersResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  /**
   * Bumped on every write.
   *
   * The recos feed is anchored on the box's members, so filing one has to
   * re-rank it — but the feed is a separate fetch from the box's own, and
   * threading `members` into its dependency list would refetch the whole crowd
   * pool on a change to a title that is not an anchor. One token, bumped
   * deliberately.
   */
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * ⚠️ Generation-guarded, because reloads are no longer awaited one at a time:
   * two can be in flight on a slow host, and the older landing last would put
   * stale counts on screen.
   */
  const loadGen = useRef(0);
  const load = useCallback(async () => {
    if (!boxId) return;
    const gen = ++loadGen.current;
    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}/members`);
      if (gen !== loadGen.current) return;
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error('box');
      const json = await res.json();
      if (gen !== loadGen.current) return;
      setData(json);
      setError('');
    } catch {
      if (gen === loadGen.current) setError(t('boxes.loadError'));
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [boxId, t]);

  useEffect(() => { if (isReady) load(); }, [isReady, load]);

  /**
   * Reload debounced, so a burst of files costs ONE reload rather than one each.
   *
   * The reload is O(catalog) server-side — `/members` maps every record by id,
   * and a cold row cache rebuilds ~26k rows (1.3s measured on a desktop, and
   * this app's host is a NAS). Filing ten titles used to pay that ten times, in
   * series, with each one blocking the next click's feedback.
   */
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadQueued = useRef(false);
  /**
   * A throttle with a trailing call, NOT a plain debounce: the first write
   * reloads at once — the reading view has no optimistic overlay, so delaying it
   * would make a single click feel slower than before — and anything inside the
   * window collapses into one trailing reload. A burst of ten files costs two.
   */
  const scheduleLoad = useCallback(() => {
    if (reloadTimer.current) { reloadQueued.current = true; return; }
    load();
    const tick = () => {
      reloadTimer.current = null;
      if (!reloadQueued.current) return;
      reloadQueued.current = false;
      load();
      reloadTimer.current = setTimeout(tick, RELOAD_DEBOUNCE_MS);
    };
    reloadTimer.current = setTimeout(tick, RELOAD_DEBOUNCE_MS);
  }, [load]);
  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); }, []);

  /**
   * Every write reloads the box rather than patching state locally.
   *
   * The units, the composition block and both counts are computed SERVER-side
   * from the collapse, so a local patch would have to re-derive them in the
   * browser to stay honest — and drifting from what the ranker sees is the one
   * thing this page must not do. One cheap request instead.
   *
   * ⚠️ **Fill mode is the one carve-out, and it is narrow.** `QuickEdit` renders
   * neither `units` nor `composition` — only the two panes and the set-aside
   * strip, all of which are plain membership — so it moves the card on click and
   * reconciles when this reload lands (see its `pending` overlay). The reading
   * view's writes stay reload-only, because those DO render the collapse. The
   * rule above is unchanged; what changed is that it no longer sits between the
   * click and the card moving.
   *
   * So this no longer awaits `load()`, and it reports whether the write itself
   * succeeded — the overlay has to roll back a rejected move.
   */
  const write = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('write');
      setError('');
      setReloadToken(n => n + 1);
      scheduleLoad();
      return true;
    } catch {
      setError(t('boxes.saveError'));
      return false;
    }
  }, [boxId, scheduleLoad, t]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('patch');
      await load();
    } catch {
      setError(t('boxes.saveError'));
    }
  }, [boxId, load, t]);

  if (notFound) {
    return (
      <div className="bx2d">
        <p className="bx2d-note">{t('boxes.notFound')}</p>
        <Link href="/boxes" className="bx2d-back">← {t('boxes.back')}</Link>
        <style jsx>{`
          .bx2d { max-width: 1100px; margin: 0 auto; padding: 24px 20px; }
          .bx2d-note { color: var(--text-muted); }
        `}</style>
        {/* `.bx2d-back` rides on a next/link, so styled-jsx never reaches it —
            see the global block at the foot of the page for the full note. */}
        <style jsx global>{`
          .bx2d .bx2d-back { color: var(--text-secondary); font-size: 0.85rem; }
        `}</style>
      </div>
    );
  }

  const box = data?.box;
  const units = data?.units ?? [];
  const excluded = data?.excluded ?? [];

  // French inflects on both halves independently, and a constructed key would
  // need a `TranslationKey` cast — the cast that disables the missing-key
  // compile check. Separate keys, chosen by ternary.
  // `<= 1` rather than `=== 1`: French takes the singular at zero as well, and
  // an empty box still renders this line above its CTA — « 0 séries · 0 entrées »
  // was on screen before this was looked at.
  const entries = box?.members.length ?? 0;
  const countKey: TranslationKey =
    entries <= 1 ? 'boxes.entriesOne'
    : units.length === 1 ? 'boxes.countOne'
    : 'boxes.count';

  /**
   * ⚠️ **An empty box opens straight into the fill path** — 13 of 26 boxes have
   * no members, so a presentation-by-default rule renders half of them as
   * nothing at all (§6.1).
   *
   * It opens on the PICKER rather than on quick-edit, deliberately. Quick-edit's
   * whole shape is source-on-the-left / box-on-the-right, and against an empty
   * box the right pane is a blank rectangle taking half the screen to say
   * nothing — the same emptiness the rule exists to avoid, just laid out. The
   * `✎` button is one click away for anyone who wants the panes.
   */
  const editing = state.edit && entries > 0;

  const tab = (key: BoxTab, labelKey: TranslationKey, badge?: number) => (
    <button
      type="button"
      className={`bx2d-tab ${state.tab === key ? 'bx2d-tabOn' : ''}`}
      onClick={() => update({ tab: key })}
    >
      {t(labelKey)}
      {badge !== undefined && badge > 0 && <span className="bx2d-badge">{badge}</span>}
    </button>
  );

  return (
    <>
      <Head><title>{box ? `${box.emoji} ${box.name}` : t('boxes.title')} — Anime Tracker</title></Head>

      {/* Fill mode gets a wider canvas — see the rule in the style block. */}
      <div className={`bx2d ${editing ? 'bx2d-wide' : ''}`}>
        <Link href="/boxes" className="bx2d-back">← {t('boxes.back')}</Link>

        {box && (
          <header className="bx2d-head">
            <input
              className="bx2d-emoji"
              defaultValue={box.emoji}
              key={`e-${box.emoji}`}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== box.emoji) patch({ emoji: v }); }}
              aria-label={t('boxes.namePlaceholder')}
              maxLength={4}
            />
            <div className="bx2d-identity">
              <input
                className="bx2d-name"
                defaultValue={box.name}
                key={`n-${box.name}`}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== box.name) patch({ name: v }); }}
                aria-label={t('boxes.namePlaceholder')}
              />
              <textarea
                className="bx2d-desc"
                defaultValue={box.description ?? ''}
                key={`d-${box.description ?? ''}`}
                rows={1}
                // Blank CLEARS, unlike the name which falls back: a box must
                // always have a name and must be allowed to have no description.
                onBlur={e => {
                  const v = e.target.value.trim();
                  if (v !== (box.description ?? '')) patch({ description: v || null });
                }}
                placeholder={t('boxes.descPlaceholder')}
                aria-label={t('boxes.descPlaceholder')}
              />
              <p className="bx2d-meta">
                <span className="bx2d-count">{t(countKey, { units: units.length, entries })}</span>
                {box.groups?.length ? <span>{t('boxes.declared', { count: box.groups.length })}</span> : null}
                {data?.missing.length ? <span>{t('boxes.missing', { count: data.missing.length })}</span> : null}
              </p>
            </div>
            <div className="bx2d-actions">
              {/* Quick edit REPLACES « Remplir » (§6.2) — it is the fill surface,
                  so the page's one fill affordance opens it. The bare picker
                  survives only for an empty box, which has nothing to show. */}
              <button
                type="button"
                className={`bx2d-btn ${state.edit ? 'bx2d-btnOn' : ''}`}
                onClick={() => update({ tab: 'pres', edit: !state.edit })}
              >
                {state.edit ? t('quickEdit.close') : `✎ ${t('quickEdit.open')}`}
              </button>
            </div>
          </header>
        )}

        <nav className="bx2d-tabs">
          {tab('pres', 'boxes.tabPres')}
          {tab('recos', 'boxes.tabRecos')}
          {tab('excluded', 'boxes.tabExcluded', excluded.length + (data?.missingExcluded.length ?? 0))}
        </nav>

        {error && <p className="bx2d-error">{error}</p>}
        {loading && <p className="bx2d-note">{t('common.loading')}</p>}

        {!loading && state.tab === 'pres' && data && (
          editing ? (
            <QuickEdit
              boxId={boxId}
              members={data.members}
              declared={box?.groups ?? []}
              excluded={excluded}
              onWrite={write}
            />
          ) : (
            <>
              {entries === 0 && (
                // An empty box has no présentation to show, so the picker is
                // what it opens on — see `editing` for why it is not quick-edit.
                <div className="bx2d-picker">
                  <AnimePicker picked={new Set(box?.members ?? [])} onPick={hit => write({ add: [hit.id] })} />
                  <p className="bx2d-note">{t('boxes.emptyBox')}</p>
                </div>
              )}
              {entries > 0 && <BoxCompositionBlock composition={data.composition} />}
              <BoxEntryList
                entries={units}
                actionIcon="−"
                actionLabel={title => t('boxes.remove', { title })}
                onAct={ids => write({ remove: ids })}
              />
            </>
          )
        )}

        {!loading && state.tab === 'recos' && (
          entries === 0 ? (
            // `computeAnchored` pools the anchors' crowd edges, so a box with no
            // members has no pool — an empty grid would read as "nothing matches"
            // rather than "there is nothing to anchor on".
            <p className="bx2d-note">{t('boxReco.noAnchors')}</p>
          ) : (
            <BoxRecos
              boxId={boxId}
              includeSeen={state.includeSeen}
              onIncludeSeenChange={v => update({ includeSeen: v })}
              cardsPerRow={state.cardsPerRow}
              onCardsPerRowChange={setCardsPerRow}
              // ⚠️ « Non » writes `exclude`, which is BOX-LOCAL. It is not a 👎,
              // not a hide and not a seed mute: a title set aside here says
              // nothing about `/recommendations` (§3).
              onVerdict={async (id, v) => { await write(v === 'yes' ? { add: [id] } : { exclude: [id] }); }}
              reloadToken={reloadToken}
            />
          )
        )}

        {!loading && state.tab === 'excluded' && (
          <>
            <p className="bx2d-note">{t('boxes.excludedIntro')}</p>
            {excluded.length === 0 && !data?.missingExcluded.length ? (
              <p className="bx2d-note">{t('boxes.excludedEmpty')}</p>
            ) : (
              <BoxEntryList
                entries={excluded.map(row => ({ row, members: [row] }))}
                actionIcon="↩"
                actionLabel={title => t('boxes.restore', { title })}
                // ⚠️ Un-excluding is NOT symmetric with excluding: it drops the
                // id from `excluded` and does not re-file it. Being wrong about
                // the judgement is not the same as saying the title belongs —
                // re-adding it is the picker's or the recos tab's job.
                onAct={ids => write({ unexclude: ids })}
              />
            )}
            {/* Excluded ids the store no longer knows. Reported rather than
                dropped: they still suppress a candidate, so a silent omission
                would make the list disagree with the ranker. */}
            {data?.missingExcluded.length ? (
              <p className="bx2d-note">
                {t('boxes.excludedMissing', { count: data.missingExcluded.length })}
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Scoped block: everything below is markup this component returns itself,
          so styled-jsx's scope class reaches all of it. `BoxEntryList` and
          `BoxCompositionBlock` style themselves through CSS Modules precisely
          because a rule here would NOT reach them. */}
      <style jsx>{`
        .bx2d { max-width: 1100px; margin: 0 auto; padding: 16px 20px 48px; }

        /*
         * Fill mode is three parallel columns (rail + two panes), so it is the
         * one state on this page that spends width on content rather than on
         * line length — and at 1100 it was spending it on ellipses instead.
         * Measured on the live store at a 2000px viewport: 138 of 687 source
         * titles truncated, falling to 35 at 1300 and 7 at 1600. Past 1600 the
         * curve is flat and the remaining gain costs the whole side margin, so
         * that is the knee rather than a round number.
         *
         * ⚠️ It is a clamp and NOT a flat 1600, because the design target is a
         * 4K TV at 300% zoom, about 1280 CSS px, where the old 1100 cap was
         * binding: a flat 1600 measured 1201 there, quietly spending the TV's
         * side margin on a layout that had been tuned with it. The middle term
         * holds 200px of margin on each side, so the canvas is EXACTLY 1100 up
         * to a 1500px viewport (the TV included, unchanged) and only grows on
         * the wide desktops that have room to give — reaching 1600 at 2000px.
         * No breakpoint, so there is no jump to land on either.
         *
         * Gated on the mode rather than applied to the page, because the
         * reading view is a description over one entry list — prose, which a
         * 1600px measure makes worse.
         */
        .bx2d-wide { max-width: clamp(1100px, 100vw - 400px, 1600px); }
        /*
         * The canvas widens for the panes, not for the prose. Name and
         * description are borderless until hover, so at 1600 the only tell was
         * a 1342px focus box around one short sentence. Capped at a readable
         * measure, and only in the wide mode — the reading view keeps the
         * geometry it already had. The two caps differ in ch because the fonts
         * do (1.35rem against 0.86rem); they are chosen to land on the same
         * ~530px, so the two fields read as one block rather than a step.
         */
        .bx2d-wide .bx2d-name { max-width: 44ch; }
        .bx2d-wide .bx2d-desc { max-width: 72ch; }

        .bx2d-head {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 10px 0 14px;
        }
        .bx2d-emoji {
          font-size: 1.9rem;
          width: 2.8rem;
          text-align: center;
          background: none;
          border: 1px solid transparent;
          border-radius: 6px;
          color: inherit;
        }
        .bx2d-identity { flex: 1; min-width: 0; }
        /*
         * ⚠️ These carry a background AT REST, not only on hover. The
         * description is a textarea with resize: vertical, so the browser paints
         * a resize grabber at its bottom-right corner — and over a transparent
         * field that little diagonal floats in open space, attached to nothing.
         * A faint fill is what makes it read as the corner of a box. Do NOT
         * "clean this up" back to background: none; the grabber comes with it.
         */
        .bx2d-name, .bx2d-desc {
          display: block;
          width: 100%;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          /* Roomier than the 2px/6px these had while transparent: padding that
             reads as breathing room around bare text reads as a cramped field
             once the box around it is visible. */
          padding: 6px 9px;
          color: var(--text-primary);
          font: inherit;
        }
        /* The two fields are a stack, not one control — they need a seam. */
        .bx2d-name { font-size: 1.35rem; font-weight: 600; margin-bottom: 6px; }
        /* min-height is a border-box floor (globals sets box-sizing globally),
           so it has to clear one line PLUS the padding and border, or the
           textarea is clamped under its own single row. */
        .bx2d-desc { font-size: 0.86rem; color: var(--text-secondary); resize: vertical; min-height: 2.3rem; }
        /* The fields already carry their edge, so hover only brightens it. */
        .bx2d-emoji:hover { border-color: var(--border-color); }
        .bx2d-name:hover, .bx2d-desc:hover { border-color: var(--text-muted); }
        .bx2d-emoji:focus, .bx2d-name:focus, .bx2d-desc:focus {
          border-color: var(--accent-primary);
          outline: none;
          background: var(--bg-tertiary);
        }

        .bx2d-meta {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          /* Left offset tracks the fields' border + padding, so the counts sit
             under the name rather than under the box's edge. */
          margin: 7px 0 0 10px;
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .bx2d-count { color: var(--text-secondary); font-variant-numeric: tabular-nums; }

        .bx2d-actions { flex-shrink: 0; }
        .bx2d-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 0.8rem;
          padding: 5px 12px;
          cursor: pointer;
          white-space: nowrap;
        }
        .bx2d-btn:hover { border-color: var(--border-hover); color: var(--text-primary); }
        .bx2d-btnOn { border-color: var(--accent-primary); color: var(--text-primary); }

        .bx2d-tabs {
          display: flex;
          gap: 4px;
          border-bottom: 1px solid var(--border-color);
          margin-bottom: 14px;
        }

        .bx2d-picker { margin-bottom: 14px; }
        .bx2d-note { color: var(--text-muted); font-size: 0.84rem; margin: 8px 0; }
        .bx2d-error { color: var(--accent-danger, #f87171); font-size: 0.85rem; }
      `}</style>

      {/* ⚠️ Global block, every selector prefixed with `.bx2d` so the prefix does
          the scoping — the split `catch-up.tsx` and `tier.tsx` already make.
          Two kinds of markup land here and NEITHER is reachable from the scoped
          block above:

          - `.bx2d-back` is a className handed to `next/link`. styled-jsx rewrites
            `className` on DOM elements only, so a className passed to a COMPONENT
            goes through untouched — the same trap `/franchise/[id]` hit, where
            every row rendered as a stack on a page that compiled clean.
          - the tabs are produced by the `tab()` helper rather than by this
            component's own `return`, so they never receive the scope class.

          Found by looking, not by building: the tabs rendered as raw UA buttons
          (outset border, #f0f0f0, black text) while the build was green and the
          class names were all present in the DOM. An unprefixed rule here really
          would be global. */}
      <style jsx global>{`
        .bx2d .bx2d-back { color: var(--text-muted); font-size: 0.82rem; text-decoration: none; }
        .bx2d .bx2d-back:hover { color: var(--text-primary); }

        .bx2d .bx2d-tab {
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--text-muted);
          font-size: 0.88rem;
          padding: 8px 14px;
          cursor: pointer;
        }
        .bx2d .bx2d-tab:hover { color: var(--text-primary); }
        .bx2d .bx2d-tabOn { color: var(--text-primary); border-bottom-color: var(--accent-primary); }
        .bx2d .bx2d-badge {
          margin-left: 6px;
          background: var(--bg-tertiary);
          border-radius: 999px;
          padding: 1px 7px;
          font-size: 0.72rem;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </>
  );
}
