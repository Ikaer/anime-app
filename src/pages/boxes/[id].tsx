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
import { useRouter } from 'next/router';
import BoxEntryList from '@/components/anime/boxes/BoxEntryList';
import BoxCompositionBlock from '@/components/anime/boxes/BoxCompositionBlock';
import QuickEdit from '@/components/anime/boxes/QuickEdit';
import BoxRecos from '@/components/anime/boxes/BoxRecos';
import { useBoxUrlState, type BoxTab } from '@/hooks';
import { useT, type TranslationKey } from '@/lib/i18n';
import { startLoadProbe } from '@/lib/clientPerf';
import { autoGrow } from '@/components/anime/boxes/autoGrow';
import type { BoxMembersResponse } from '../api/anime/boxes/[id]/members';

/**
 * The reload throttle's window. Long enough to swallow a run of clicks, short
 * enough that the header counts settle while you are still looking at the pane.
 */
const RELOAD_DEBOUNCE_MS = 400;

export default function BoxV2DetailPage() {
  const t = useT();
  const { boxId, state, update, setCardsPerRow, isReady } = useBoxUrlState();
  const router = useRouter();
  /**
   * Deleting is two clicks, and the second one is IN PLACE rather than a
   * `window.confirm`: this app has no native dialog anywhere, and the group
   * blade is a blade precisely so it is not a modal. `user/boxes.json` is
   * durable labeling no provider can re-supply, so the first click only arms.
   */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
  const probedBox = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!boxId) return;
    const gen = ++loadGen.current;
    try {
      const url = `/api/anime/boxes/${encodeURIComponent(boxId)}/members`;
      // The first load of THIS box is the one waited on; the rest follow writes.
      const probe = startLoadProbe('box', url, probedBox.current === boxId ? 'reload' : 'initial');
      probedBox.current = boxId;
      const res = await fetch(url);
      if (gen !== loadGen.current) return;
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error('box');
      const json = await res.json();
      if (gen !== loadGen.current) return;
      setData(json);
      probe.done();
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

  /**
   * ⚠️ Navigates away rather than reloading: the box is gone, so `load()` would
   * 404 into `setNotFound` and flash the not-found page before the redirect.
   * Nothing else needs sweeping — regroupements are global and no file
   * references a box id, so a box leaves no dangling pointer behind.
   */
  const removeBox = useCallback(async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete');
      await router.push('/boxes');
    } catch {
      setError(t('boxes.deleteError'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [boxId, router, t]);

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
   * **Edition mode** — the one place a box is edited. Présentation is read-only
   * on purpose: it used to carry in-place name/emoji/description fields and a
   * `−` on every poster, which made the page read as a form and a stray click a
   * write. Now présentation answers "what is this box" and edition answers
   * "change it" — the header's fields, the panes, the écartés strip.
   *
   * ⚠️ The gate is the explicit request and NOTHING else — no `entries > 0`
   * clause. An empty box edits fine (an empty box pane is a state quick edit
   * renders), and a clause here once made the button's label and the content
   * disagree. `edit` only means something on présentation, which is also the
   * only tab the URL ever writes it for.
   */
  const editing = state.edit && state.tab === 'pres';

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

  const meta = box && (
    <p className="bx2d-meta">
      <span className="bx2d-count">{t(countKey, { units: units.length, entries })}</span>
      {box.groups?.length ? (
        <span className="bx2d-metaSep">
          {box.groups.length === 1
            ? t('boxes.declaredOne', { count: 1 })
            : t('boxes.declared', { count: box.groups.length })}
        </span>
      ) : null}
      {data?.missing.length ? (
        <span className="bx2d-metaSep">{t('boxes.missing', { count: data.missing.length })}</span>
      ) : null}
    </p>
  );

  return (
    <>
      <Head><title>{box ? `${box.emoji} ${box.name}` : t('boxes.title')} — Anime Tracker</title></Head>

      {/* Edition and the recos grid get a wider canvas — see the rule in the
          style block. */}
      <div className={`bx2d ${editing || state.tab === 'recos' ? 'bx2d-wide' : ''}`}>
        <Link href="/boxes" className="bx2d-back">← {t('boxes.back')}</Link>

        {box && !editing && (
          <header className="bx2d-head">
            <span className="bx2d-emoji" aria-hidden="true">{box.emoji}</span>
            <div className="bx2d-identity">
              <h1 className="bx2d-name">{box.name}</h1>
              {box.description && <p className="bx2d-desc">{box.description}</p>}
              {meta}
            </div>
            {/* The group blade's footer, transposed: the destructive control
                quiet and set apart on the leading side, the page's one real
                action filled at the trailing edge. Delete lives HERE and not in
                edition: edition is for changing the box, and a delete sitting
                beside « Retour » is one slip away from the wrong click. */}
            <div className="bx2d-actions">
              <button
                type="button"
                className={`bx2d-btn bx2d-btnDanger ${confirmDelete ? 'bx2d-btnOn' : ''}`}
                onClick={() => setConfirmDelete(v => !v)}
                disabled={deleting}
              >
                🗑 {t('boxes.delete')}
              </button>
              <button
                type="button"
                className="bx2d-btn bx2d-btnPrimary"
                onClick={() => { setConfirmDelete(false); update({ tab: 'pres', edit: true }); }}
              >
                ✎ {t('quickEdit.open')}
              </button>
            </div>
          </header>
        )}

        {/* Edition's header: the same block, as fields. Visibly fields — bordered
            at rest — because in this mode editing is the point, and the fields
            are what say which mode you are in. Blur saves, as before. */}
        {box && editing && (
          <header className="bx2d-head bx2d-headEdit">
            <input
              className="bx2d-emoji bx2d-field"
              defaultValue={box.emoji}
              key={`e-${box.emoji}`}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== box.emoji) patch({ emoji: v }); }}
              aria-label="emoji"
              maxLength={4}
            />
            <div className="bx2d-identity">
              <input
                className="bx2d-name bx2d-field"
                defaultValue={box.name}
                key={`n-${box.name}`}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== box.name) patch({ name: v }); }}
                placeholder={t('boxes.namePlaceholder')}
                aria-label={t('boxes.namePlaceholder')}
              />
              <textarea
                className="bx2d-desc bx2d-field"
                defaultValue={box.description ?? ''}
                key={`d-${box.description ?? ''}`}
                rows={1}
                ref={autoGrow}
                onInput={e => autoGrow(e.currentTarget)}
                // Blank CLEARS, unlike the name which falls back: a box must
                // always have a name and must be allowed to have no description.
                onBlur={e => {
                  const v = e.target.value.trim();
                  if (v !== (box.description ?? '')) patch({ description: v || null });
                }}
                placeholder={t('boxes.descPlaceholder')}
                aria-label={t('boxes.descPlaceholder')}
              />
              {meta}
            </div>
            <div className="bx2d-actions">
              <button
                type="button"
                className="bx2d-btn"
                onClick={() => update({ tab: 'pres', edit: false })}
              >
                ← {t('quickEdit.close')}
              </button>
            </div>
          </header>
        )}

        {/* The confirmation sits on its own line under the header rather than in
            the actions column: it names the box and says what survives, which is
            a sentence, and the actions column is sized for two short buttons. */}
        {box && confirmDelete && !editing && (
          <div className="bx2d-confirm" role="alertdialog" aria-label={t('boxes.delete')}>
            <span className="bx2d-confirmText">
              {entries === 0
                ? t('boxes.deleteConfirmEmpty', { name: box.name })
                : entries === 1
                  ? t('boxes.deleteConfirmOne', { name: box.name })
                  : t('boxes.deleteConfirm', { name: box.name, count: entries })}
            </span>
            <button type="button" className="bx2d-btn bx2d-btnDangerSolid" onClick={removeBox} disabled={deleting}>
              {deleting ? t('boxes.deleting') : t('boxes.deleteYes')}
            </button>
            <button type="button" className="bx2d-btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              {t('boxes.deleteNo')}
            </button>
          </div>
        )}

        {/* No tabs in edition: it is a mode you enter and leave by « Retour à la
            présentation », and a tab bar over it would claim you were still on
            présentation. */}
        {!editing && (
          <nav className="bx2d-tabs">
            {tab('pres', 'boxes.tabPres')}
            {tab('recos', 'boxes.tabRecos')}
            {tab('excluded', 'boxes.tabExcluded', excluded.length + (data?.missingExcluded.length ?? 0))}
          </nav>
        )}

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
              onGroupsChanged={scheduleLoad}
            />
          ) : entries === 0 ? (
            // Read-only présentation has nothing to show for an empty box, so it
            // says so and points at the one place a box is filled.
            <div className="bx2d-empty">
              <p>{t('boxes.emptyBox')}</p>
              <button
                type="button"
                className="bx2d-btn bx2d-btnPrimary"
                onClick={() => update({ tab: 'pres', edit: true })}
              >
                ✎ {t('quickEdit.open')}
              </button>
            </div>
          ) : (
            <>
              <BoxCompositionBlock composition={data.composition} />
              <BoxEntryList entries={units} />
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
         * Fill mode is parallel columns (two panes, plus the filter rail when
         * unfolded), so it is the one state on this page that spends width on
         * content rather than on line length — and at 1100 it was spending it
         * on ellipses instead. The numbers below were measured with the rail
         * always open and 32px posters; the rail now starts folded.
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
         * 1600px measure makes worse. The recos tab shares it: that is a card
         * grid, and at 1100 six cards a row are 150px wide.
         */
        .bx2d-wide { max-width: clamp(1100px, 100vw - 400px, 1600px); }

        /*
         * The header is the landing card, opened: the same emoji tile (larger),
         * the same name, description and meta line. Read-only on présentation —
         * a heading and a paragraph — and fields only in edition (bx2d-field
         * below), so a box reads as one object on both pages and the page only
         * looks like a form when it is one.
         */
        .bx2d-head {
          display: flex;
          align-items: flex-start;
          gap: 18px;
          margin: 14px 0 20px;
        }
        .bx2d-emoji {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 64px;
          height: 64px;
          padding: 0;
          font-size: 2.1rem;
          line-height: 1;
          text-align: center;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          color: inherit;
        }
        .bx2d-identity { flex: 1; min-width: 0; }
        .bx2d-name {
          display: block;
          margin: 2px 0 0;
          font-size: 1.6rem;
          font-weight: 700;
          line-height: 1.25;
          color: var(--text-primary);
        }
        .bx2d-desc {
          display: block;
          max-width: 72ch;
          margin: 6px 0 0;
          font-size: 0.92rem;
          line-height: 1.5;
          color: var(--text-secondary);
          white-space: pre-line;
        }

        /*
         * Edition's fields: bordered at rest, because in this mode editing is the
         * point and the borders are what say which mode you are in. The
         * description grows with its text (autoGrow) and has no resize handle.
         * Capped at a readable measure — the canvas widens to 1600 here for the
         * panes, not for one sentence.
         */
        .bx2d-field {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          color: var(--text-primary);
          font-family: inherit;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .bx2d-field:hover { border-color: var(--border-hover); }
        .bx2d-field:focus { border-color: var(--accent-primary); outline: none; background: var(--bg-tertiary); }
        .bx2d-field::placeholder { color: var(--text-muted); font-style: italic; }
        .bx2d-emoji.bx2d-field { cursor: text; }
        .bx2d-name.bx2d-field { width: 100%; max-width: 40ch; margin: 0; padding: 4px 10px; }
        .bx2d-desc.bx2d-field {
          width: 100%;
          max-width: 72ch;
          padding: 6px 10px;
          resize: none;
          overflow: hidden;
          white-space: normal;
        }

        .bx2d-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 40px 16px;
          border: 1px dashed var(--border-hover);
          border-radius: 12px;
          color: var(--text-muted);
          font-size: 0.9rem;
        }


        .bx2d-actions { flex-shrink: 0; display: flex; align-items: center; gap: 12px; padding-top: 4px; }
        .bx2d-confirm {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin: -6px 0 16px;
          padding: 10px 14px;
          border: 1px solid var(--accent-danger);
          border-radius: 10px;
          background: rgba(248, 113, 113, 0.06);
        }
        .bx2d-confirmText { flex: 1; min-width: 240px; font-size: 0.85rem; color: var(--text-primary); }
        /* The box system's button spec, shared by hand with its CSS Modules. */
        .bx2d-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 0.78rem;
          line-height: 1.4;
          padding: 5px 12px;
          cursor: pointer;
          white-space: nowrap;
          transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
        }
        .bx2d-btn:hover { border-color: var(--border-hover); color: var(--text-primary); }
        .bx2d-btn:disabled { opacity: 0.6; cursor: default; }
        .bx2d-btnOn { border-color: var(--accent-primary); color: var(--text-primary); }
        /* After .bx2d-btn on purpose: same specificity, so source order decides. */
        .bx2d-btnPrimary {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
          color: #fff;
          font-weight: 600;
          padding: 6px 16px;
        }
        .bx2d-btnPrimary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: #fff; }
        /* Ghost at rest — no fill, no border, muted text — so the page's one
           destructive control does not compete with « Remplir »; it only reads
           as dangerous once reached for. Same treatment as the group blade. */
        .bx2d-btnDanger {
          background: none;
          border-color: transparent;
          color: var(--text-muted);
          padding: 5px 8px;
        }
        .bx2d-btnDanger:hover, .bx2d-btnDanger.bx2d-btnOn {
          border-color: var(--accent-danger);
          color: var(--accent-danger);
          background: none;
        }
        .bx2d-btnDangerSolid {
          background: var(--accent-danger-strong);
          border-color: var(--accent-danger-strong);
          color: #fff;
          font-weight: 600;
        }
        .bx2d-btnDangerSolid:hover { color: #fff; border-color: var(--accent-danger-strong); filter: brightness(1.1); }

        .bx2d-tabs {
          display: flex;
          gap: 4px;
          border-bottom: 1px solid var(--border-color);
          margin-bottom: 16px;
        }

        .bx2d-note { color: var(--text-muted); font-size: 0.85rem; margin: 8px 0; }
        .bx2d-error { color: var(--accent-danger); font-size: 0.85rem; }
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
        .bx2d .bx2d-meta {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin: 8px 0 0;
          font-size: 0.78rem;
          color: var(--text-muted);
        }
        .bx2d .bx2d-count { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
        .bx2d .bx2d-metaSep::before { content: '·'; margin-right: 10px; color: var(--border-hover); }

        .bx2d .bx2d-back { color: var(--text-muted); font-size: 0.82rem; text-decoration: none; }
        .bx2d .bx2d-back:hover { color: var(--text-primary); }

        .bx2d .bx2d-tab {
          display: inline-flex;
          align-items: center;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          color: var(--text-muted);
          font-size: 0.9rem;
          font-weight: 500;
          padding: 8px 14px;
          cursor: pointer;
          transition: color 0.15s ease, border-color 0.15s ease;
        }
        .bx2d .bx2d-tab:hover { color: var(--text-primary); }
        .bx2d .bx2d-tabOn { color: var(--text-primary); font-weight: 600; border-bottom-color: var(--accent-primary); }
        .bx2d .bx2d-badge {
          margin-left: 7px;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 0 7px;
          font-size: 0.7rem;
          line-height: 1.6;
          font-variant-numeric: tabular-nums;
        }
      `}</style>
    </>
  );
}
