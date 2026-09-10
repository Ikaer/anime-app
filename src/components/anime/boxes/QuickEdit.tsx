import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AnimePicker from '../AnimePicker';
import { RecoFiltersSection } from '../sidebar';
import QuickEditPane, { type PaneGroupRegion } from './QuickEditPane';
import GroupBlade from './GroupBlade';
import BoxEntryList from './BoxEntryList';
import { useT } from '@/lib/i18n';
import { groupsPresentIn } from '@/lib/domain/boxUnits';
import type { LeanAnimeRow } from '@/lib/domain/leanRow';
import type { GroupSummary } from '@/lib/domain/groupSummary';
import type { WatchedResponse } from '@/pages/api/anime/watched';
import type { GroupListResponse } from '@/pages/api/anime/groups';
import styles from './QuickEdit.module.css';

/**
 * Quick edit — the fill surface, and the thing that replaces « Remplir »
 * entirely (§6.2).
 *
 * Three regions: source (top left), the box (top right), and « écartés » as one
 * full-width collapsible strip below — not a quadrant, because excluded is a
 * much rarer state than the other two and does not deserve half the screen.
 *
 * **It is a MODE on présentation, not a fourth tab.** "What is this box" stays
 * the page's answer; filling it is something you do to that answer.
 *
 * Two decisions worth stating, because neither is forced by the design:
 *
 * - **The whole watched list is fetched once and filtered in the browser**, so
 *   changing a filter never refetches and the panes never blink. ⚠️ With one
 *   exception: `search` goes to the SERVER. `applyNarrowingFilters` matches
 *   romaji + English + Japanese + synonyms, and a lean row carries only the
 *   title currently displayed — so a client-side title match would quietly stop
 *   a `native` reader finding a show by the name on their own screen, which is
 *   the invariant CLAUDE.md spells out for exactly this trap.
 * - **The filters live in a left rail of this mode**, not in the page's own
 *   sidebar. Présentation and écartés have nothing to filter, and the box's
 *   identity header and tabs have to stay above all three — promoting the whole
 *   page to `AnimePageLayout` would push them into a column beside a sidebar
 *   that is empty two thirds of the time.
 */
export interface QuickEditProps {
  boxId: string;
  /** The box's members, resolved — présentation's own list, reused. */
  members: LeanAnimeRow[];
  /** Declared group ids. */
  declared: string[];
  excluded: LeanAnimeRow[];
  /**
   * Fired after any write; the page reloads the box and hands new props back.
   *
   * ⚠️ It resolves `false` when the write FAILED. That is load-bearing rather
   * than informational: the panes move the card before the server answers, so
   * without a failure signal a rejected write leaves the overlay asserting a
   * move that never happened, and the pane lies until the next reload.
   */
  onWrite: (body: Record<string, unknown>) => Promise<boolean>;
}

interface Filters {
  search: string;
  mediaTypes: string[];
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
}

const NO_FILTERS: Filters = {
  search: '', mediaTypes: [], minScore: null, maxScore: null, minYear: null, maxYear: null,
};

/** Which pane a selection belongs to. A range is only meaningful within one. */
type PaneKind = 'source' | 'box';

/**
 * Where a title sits. The three panes ARE this union, which is what lets one
 * `Map<id, Place>` stand for every move: filing, un-filing, setting aside and
 * restoring all just name a destination, and re-moving the same title
 * overwrites its entry instead of stacking a second pending op.
 */
type Place = 'box' | 'source' | 'aside';

/** Where the server says a title is — the truth the overlay is reconciled against. */
const placeOf = (id: string, memberIds: Set<string>, asideIds: Set<string>): Place =>
  memberIds.has(id) ? 'box' : asideIds.has(id) ? 'aside' : 'source';

const QuickEdit: React.FC<QuickEditProps> = ({ boxId, members, declared, excluded, onWrite }) => {
  const t = useT();

  const [watched, setWatched] = useState<LeanAnimeRow[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [loading, setLoading] = useState(true);
  const [showExcluded, setShowExcluded] = useState(false);

  const [selection, setSelection] = useState<{ pane: PaneKind; ids: string[] } | null>(null);
  const [blade, setBlade] = useState<{ seedFrom?: string; group?: GroupSummary } | null>(null);

  /**
   * Moves already on screen that the server has not confirmed yet.
   *
   * ⚠️ **The panes render through this, and that is the whole fix.** A file used
   * to be a PUT plus a full box reload before ANYTHING moved, with no pending
   * state in between — so on a slow host the card sat still for seconds and the
   * only way to tell a click had registered was that it eventually worked. The
   * reload still happens and the server is still the authority; it just stopped
   * being on the path between the click and the card moving.
   *
   * Held HERE and not on the page on purpose: the page's `editing` gate reads
   * `box.members.length`, so an optimistic member count would unmount this whole
   * surface mid-interaction the moment the last member was removed. Keeping the
   * overlay below that line leaves every count the page renders on server truth.
   */
  const [pending, setPending] = useState<Map<string, Place>>(new Map());

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters(f => ({ ...f, [key]: value }));

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/groups');
      if (res.ok) setGroups(((await res.json()) as GroupListResponse).groups);
    } catch { /* the panes degrade to their flat regions */ }
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // Only `search` is a server round-trip; see the header note. Debounced, since
  // the endpoint scans the statused list.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const qs = filters.search.trim() ? `?search=${encodeURIComponent(filters.search.trim())}` : '';
        const res = await fetch(`/api/anime/watched${qs}`);
        if (!res.ok) throw new Error('watched');
        const data: WatchedResponse = await res.json();
        if (!cancelled) setWatched(data.rows);
      } catch { /* keep whatever is on screen */ }
      finally { if (!cancelled) setLoading(false); }
    }, filters.search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [filters.search]);

  // Escape clears the selection — the design's own undo for an accidental one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !blade) setSelection(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [blade]);

  const serverMemberIds = useMemo(() => new Set(members.map(r => r.id)), [members]);
  const serverAsideIds = useMemo(() => new Set(excluded.map(r => r.id)), [excluded]);

  /**
   * Drop overlay entries the server has caught up with.
   *
   * Confirmation rather than a generation counter, which also disarms
   * out-of-order reloads for free: a stale response simply fails to agree, so
   * the entry survives until a fresh one confirms it. Nothing here can clobber
   * a move the owner has already made.
   */
  useEffect(() => {
    setPending(prev => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const [id, place] of prev) {
        if (placeOf(id, serverMemberIds, serverAsideIds) === place) next.delete(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [serverMemberIds, serverAsideIds]);

  /** Every row this surface can name, so an optimistically moved id resolves to a card. */
  const rowById = useMemo(() => {
    const map = new Map<string, LeanAnimeRow>();
    for (const r of watched) map.set(r.id, r);
    for (const r of members) map.set(r.id, r);
    for (const r of excluded) map.set(r.id, r);
    return map;
  }, [watched, members, excluded]);

  /** The three sets as they are ON SCREEN — server truth with the overlay applied. */
  const memberIds = useMemo(() => {
    const ids = new Set(serverMemberIds);
    for (const [id, place] of pending) { if (place === 'box') ids.add(id); else ids.delete(id); }
    return ids;
  }, [serverMemberIds, pending]);

  const excludedIds = useMemo(() => {
    const ids = new Set(serverAsideIds);
    for (const [id, place] of pending) { if (place === 'aside') ids.add(id); else ids.delete(id); }
    return ids;
  }, [serverAsideIds, pending]);

  const asideRows = useMemo(
    () => [...excludedIds].map(id => rowById.get(id)).filter((r): r is LeanAnimeRow => !!r),
    [excludedIds, rowById]
  );

  /** The cheap filters, applied in the browser over the whole fetched set. */
  const passes = useCallback((row: LeanAnimeRow) => {
    if (filters.mediaTypes.length > 0 && !filters.mediaTypes.includes((row.mediaType ?? '').toLowerCase())) return false;
    if (filters.minScore !== null && (row.mean ?? -1) < filters.minScore) return false;
    if (filters.maxScore !== null && (row.mean ?? 999) > filters.maxScore) return false;
    if (filters.minYear !== null && (row.year ?? -1) < filters.minYear) return false;
    if (filters.maxYear !== null && (row.year ?? 9999) > filters.maxYear) return false;
    return true;
  }, [filters]);

  /**
   * Source = watched, minus what is already filed, minus what was set aside.
   *
   * Subtracted here rather than server-side on purpose: the pane knows both sets
   * already, and asking the server would make the response box-specific AND
   * refetch on every single file.
   */
  const source = useMemo(
    () => watched.filter(r => !memberIds.has(r.id) && !excludedIds.has(r.id) && passes(r)),
    [watched, memberIds, excludedIds, passes]
  );
  const boxRows = useMemo(
    () => [...memberIds].map(id => rowById.get(id)).filter((r): r is LeanAnimeRow => !!r).filter(passes),
    [memberIds, rowById, passes]
  );

  const groupsByAnime = useMemo(() => {
    const map = new Map<string, GroupSummary[]>();
    for (const g of groups) {
      for (const id of g.members) {
        const list = map.get(id);
        if (list) list.push(g); else map.set(id, [g]);
      }
    }
    return map;
  }, [groups]);

  const toRegion = (hits: { group: { id: string }; members: string[] }[]): PaneGroupRegion[] =>
    hits
      .map(h => ({ group: groups.find(g => g.id === h.group.id)!, members: h.members }))
      .filter(r => !!r.group);

  // ⚠️ The two panes read DIFFERENT group sets, and that is §6.2's rule rather
  // than an optimization. The source pane offers every global group — nothing
  // there is declared yet and the region exists to let one click file a show.
  // The box pane shows only the DECLARED ones, because that region is a picture
  // of how the ranker sees the box.
  const sourceRegions = useMemo(
    () => toRegion(groupsPresentIn(groups, new Set(source.map(r => r.id)))),
    [groups, source] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const boxRegions = useMemo(
    () => toRegion(groupsPresentIn(groups.filter(g => declared.includes(g.id)), new Set(boxRows.map(r => r.id)))),
    [groups, declared, boxRows] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * The declaration nudge (§4): « ces 4 entrées appartiennent au regroupement
   * Bleach — les compter comme une seule ? »
   *
   * ⚠️ It sits ABOVE the box pane rather than inside its groups region. Putting
   * it in the region would break what the region means — it is a picture of how
   * the ranker sees the box, and an undeclared group casts no collapsed vote.
   * And it is an OFFER: auto-applying every group wherever its members happened
   * to land was designed first and rejected, because it silently imposes a
   * judgement made for a different box.
   */
  const nudges = useMemo(
    () => toRegion(groupsPresentIn(groups.filter(g => !declared.includes(g.id)), new Set(members.map(r => r.id)))),
    [groups, declared, members] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const select = (pane: PaneKind, id: string, shift: boolean) => {
    const list = (pane === 'source' ? source : boxRows).map(r => r.id);
    setSelection(prev => {
      // A range is only meaningful within one pane, so switching panes starts over.
      if (!prev || prev.pane !== pane) return { pane, ids: [id] };
      if (shift && prev.ids.length > 0) {
        const from = list.indexOf(prev.ids[prev.ids.length - 1]);
        const to = list.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          return { pane, ids: [...new Set([...prev.ids, ...list.slice(lo, hi + 1)])] };
        }
      }
      return prev.ids.includes(id)
        ? { pane, ids: prev.ids.filter(x => x !== id) }
        : { pane, ids: [...prev.ids, id] };
    });
  };

  /**
   * Apply a move on screen, then write it.
   *
   * ⚠️ Only the four ROW moves are optimistic. `declare`/`undeclare` restructure
   * the group regions, which are derived from a prop this component does not
   * own, so they ride the reload — a group card filed with `{ add, declare }`
   * moves its titles at once and grows its region when the box comes back.
   */
  const act = useCallback(async (body: Record<string, unknown>) => {
    setSelection(null);

    const moves = new Map<string, Place>();
    const move = (key: string, place: Place) => {
      const ids = body[key];
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') moves.set(id, place);
    };
    move('add', 'box');
    move('remove', 'source');
    move('exclude', 'aside');
    move('unexclude', 'source');

    if (moves.size > 0) {
      setPending(prev => {
        const next = new Map(prev);
        for (const [id, place] of moves) next.set(id, place);
        return next;
      });
    }

    const ok = await onWrite(body);
    if (!ok && moves.size > 0) {
      // Roll the overlay back to whatever the server last said, so a failed
      // write reads as "it did not move" rather than as a move that silently
      // un-happens on the next reload.
      setPending(prev => {
        const next = new Map(prev);
        for (const id of moves.keys()) next.delete(id);
        return next;
      });
    }
    return ok;
  }, [onWrite]);

  const selectedIds = useMemo(() => new Set(selection?.ids ?? []), [selection]);

  return (
    <div className={styles.wrap}>
      <aside className={styles.rail}>
        <RecoFiltersSection
          search={filters.search}
          onSearchChange={v => set('search', v)}
          mediaTypes={filters.mediaTypes}
          onMediaTypesChange={v => set('mediaTypes', v)}
          minScore={filters.minScore}
          onMinScoreChange={v => set('minScore', v)}
          maxScore={filters.maxScore}
          onMaxScoreChange={v => set('maxScore', v)}
          minYear={filters.minYear}
          maxYear={filters.maxYear}
          onYearChange={(min, max) => setFilters(f => ({ ...f, minYear: min, maxYear: max }))}
        />

        {/* Placement 2 of 3 (§4): the index — every group, its size, and the way
            in to edit or create one. It costs no working-pane width, which is
            why it is here and not a fourth pane. */}
        <section className={styles.index}>
          <h3 className={styles.indexHead}>{t('quickEdit.groupsIndex')}</h3>
          <button type="button" className={styles.newGroup} onClick={() => setBlade({})}>
            + {t('quickEdit.newGroup')}
          </button>
          {groups.length === 0 ? (
            <p className={styles.indexEmpty}>{t('quickEdit.noGroups')}</p>
          ) : (
            <ul className={styles.indexList}>
              {groups.map(g => {
                const here = g.members.filter(id => memberIds.has(id)).length;
                return (
                  <li key={g.id}>
                    <button type="button" className={styles.indexRow} onClick={() => setBlade({ group: g })}>
                      <span className={styles.indexName}>{g.name}</span>
                      <span className={styles.indexCount}>
                        {here > 0 ? t('quickEdit.indexHere', { here, count: g.count }) : g.count}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </aside>

      <div className={styles.body}>
        {nudges.length > 0 && (
          <div className={styles.nudges}>
            {nudges.map(({ group, members: present }) => (
              <div key={group.id} className={styles.nudge}>
                <span>{t('quickEdit.nudge', { count: present.length, name: group.name })}</span>
                <button type="button" className={styles.nudgeYes}
                  onClick={() => act({ declare: [group.id] })}>
                  {t('quickEdit.nudgeYes')}
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.panes}>
          <QuickEditPane
            variant="source"
            title={t('quickEdit.sourceTitle')}
            rows={source}
            groupRegions={sourceRegions}
            groupsByAnime={groupsByAnime}
            selected={selection?.pane === 'source' ? selectedIds : new Set()}
            onToggleSelect={(id, shift) => select('source', id, shift)}
            // ⚠️ Filing from a source GROUP card writes both — the ids into
            // `members` and the group id into `groups` (§4). One click, both
            // effects, so the ordinary path still feels automatic. A single `+`
            // does not declare: one title is not a statement about a show.
            onAdd={ids => act(ids.length > 1
              ? { add: ids, declare: sourceRegions.filter(r => r.members.every(m => ids.includes(m))).map(r => r.group.id) }
              : { add: ids })}
            onExclude={ids => act({ exclude: ids })}
            onOpenGroup={g => setBlade({ group: g })}
            onCreateGroup={id => setBlade({ seedFrom: id })}
            // Dropped ON the source pane = taken out of the box.
            onDropIds={ids => act({ remove: ids })}
          >
            {/* The picker stays (§1): adding an unwatched title deliberately is
                a wanted feature, and the source pane is watched-only by scope. */}
            <div className={styles.picker}>
              <AnimePicker
                picked={memberIds}
                onPick={hit => act({ add: [hit.id] })}
                placeholder={t('quickEdit.pickerPlaceholder')}
              />
            </div>
          </QuickEditPane>

          <QuickEditPane
            variant="box"
            title={t('quickEdit.boxTitle')}
            rows={boxRows}
            groupRegions={boxRegions}
            groupsByAnime={groupsByAnime}
            selected={selection?.pane === 'box' ? selectedIds : new Set()}
            onToggleSelect={(id, shift) => select('box', id, shift)}
            onRemove={ids => act({ remove: ids })}
            onUndeclare={id => act({ undeclare: [id] })}
            onOpenGroup={g => setBlade({ group: g })}
            onCreateGroup={id => setBlade({ seedFrom: id })}
            onDropIds={ids => act({ add: ids })}
          />
        </div>

        {/* One full-width collapsible strip, not a quadrant: excluded is a much
            rarer state than the other two. */}
        <section className={styles.excluded}>
          <button type="button" className={styles.excludedHead} onClick={() => setShowExcluded(v => !v)}>
            {showExcluded ? '▾' : '▸'} {t('quickEdit.excluded', { count: asideRows.length })}
          </button>
          {showExcluded && (
            asideRows.length === 0
              ? <p className={styles.excludedEmpty}>{t('boxes.excludedEmpty')}</p>
              : <BoxEntryList
                  entries={asideRows.map(row => ({ row, members: [row] }))}
                  actionIcon="↩"
                  actionLabel={title => t('boxes.restore', { title })}
                  onAct={ids => act({ unexclude: ids })}
                />
          )}
        </section>

        {loading && <p className={styles.note}>{t('common.loading')}</p>}
      </div>

      {/* The bulk bar appears WITH a selection and states which pane it acts on;
          the actions differ by side, so a single set of verbs would be wrong. */}
      {selection && selection.ids.length > 0 && (
        <div className={styles.bulk}>
          <span className={styles.bulkCount}>{t('quickEdit.selected', { count: selection.ids.length })}</span>
          {selection.pane === 'source' ? (
            <>
              <button type="button" className={styles.bulkAdd} onClick={() => act({ add: selection.ids })}>
                {t('quickEdit.bulkAdd', { count: selection.ids.length })}
              </button>
              <button type="button" className={styles.bulkBtn} onClick={() => act({ exclude: selection.ids })}>
                {t('quickEdit.bulkExclude', { count: selection.ids.length })}
              </button>
            </>
          ) : (
            <button type="button" className={styles.bulkBtn} onClick={() => act({ remove: selection.ids })}>
              {t('quickEdit.bulkRemove', { count: selection.ids.length })}
            </button>
          )}
          <button type="button" className={styles.bulkBtn} onClick={() => setSelection(null)}>
            {t('quickEdit.clearSelection')}
          </button>
        </div>
      )}

      {blade && (
        <GroupBlade
          seedFrom={blade.seedFrom}
          group={blade.group}
          allGroups={groups}
          onClose={() => setBlade(null)}
          onSaved={async () => { setBlade(null); await loadGroups(); }}
        />
      )}
    </div>
  );
};

export default QuickEdit;
