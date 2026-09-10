import React, { useState } from 'react';
import Image from 'next/image';
import { useT } from '@/lib/i18n';
import type { LeanAnimeRow } from '@/lib/domain/leanRow';
import type { GroupSummary } from '@/lib/domain/groupSummary';
import styles from './QuickEditPane.module.css';

/**
 * One quick-edit pane — source or box.
 *
 * ⚠️ **Each pane is TWO regions, not one flat list** (§6.2), and that split is
 * what removes §4's tie-break. A groups region on top holds one card per group
 * with **≥2** of its members present here; a flat region below holds everything
 * else. A title is free to appear under more than one card, because math and
 * display answer different questions: the vote fuses two overlapping declared
 * groups into one unit, the screen keeps them as two cards. An earlier draft
 * assumed one draw per title and paid for it with an invented tie-break and a
 * divergence marker — both removed. Do not reintroduce a single-draw rule.
 *
 * ⚠️ **A group with exactly one member present stays in the flat region**,
 * carrying a chip. The groups region's job is "here are the collapses actually
 * happening", and a wall of one-item cards would empty that of meaning.
 *
 * ⚠️ **The two panes populate that region from different sets**, which is why
 * `groupRegions` is a prop rather than derived here. The BOX pane is handed only
 * `box.groups` — that region is a picture of how the RANKER sees the box, and an
 * undeclared group casts no collapsed vote. The SOURCE pane is handed every
 * global group with ≥2 present: nothing there is declared yet, and the region is
 * a browsing convenience whose point is letting one click file a whole show.
 *
 * **Interaction splits three ways, because a click cannot mean both "select" and
 * "move"** — and the body selects rather than moves because the source pane
 * holds ~600 rows: an accidental click that files something is a mistake you
 * then have to hunt for, while an accidental selection costs nothing.
 *
 *  - **Card body = select.** Shift-click extends a range within the pane.
 *  - **Hover buttons = act on that one card**, so filing one at a time stays a
 *    single click.
 *  - **Drag = move**, and dragging a card that is part of the selection drags
 *    the whole selection.
 *
 * Native HTML5 drag, no library — `/tier`'s rule, and this repo hand-rolled that
 * one to avoid a layout dependency.
 */

/** The MIME type the panes exchange. A custom type so nothing else claims the drop. */
export const DRAG_TYPE = 'application/x-anime-ids';

export interface PaneGroupRegion {
  group: GroupSummary;
  /** The group's members that are present in THIS pane. Always ≥2. */
  members: string[];
}

export interface QuickEditPaneProps {
  variant: 'source' | 'box';
  title: string;
  /** Everything in this pane, already filtered. */
  rows: LeanAnimeRow[];
  groupRegions: PaneGroupRegion[];
  /** Which groups hold a title, for the flat region's chips. */
  groupsByAnime: Map<string, GroupSummary[]>;
  selected: Set<string>;
  onToggleSelect: (id: string, shift: boolean) => void;
  /** source: `+` and « Ajouter les N ». */
  onAdd?: (ids: string[]) => void;
  /** source: `⊘`. */
  onExclude?: (ids: string[]) => void;
  /** box: `−`. */
  onRemove?: (ids: string[]) => void;
  /** box: stop counting a declared group as one unit. */
  onUndeclare?: (groupId: string) => void;
  onOpenGroup: (group: GroupSummary) => void;
  onCreateGroup: (seedFrom: string) => void;
  /** Ids dropped onto this pane. */
  onDropIds: (ids: string[]) => void;
  /** Rendered above the list — the source pane's picker. */
  children?: React.ReactNode;
}

const QuickEditPane: React.FC<QuickEditPaneProps> = ({
  variant, title, rows, groupRegions, groupsByAnime, selected,
  onToggleSelect, onAdd, onExclude, onRemove, onUndeclare,
  onOpenGroup, onCreateGroup, onDropIds, children,
}) => {
  const t = useT();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

  const byId = new Map(rows.map(r => [r.id, r]));
  const toggleOpen = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /**
   * ⚠️ The flat region excludes only titles drawn in a group CARD, not every
   * grouped title. A title whose group has one member here has no card, so it
   * must still appear — otherwise it would vanish from the pane entirely.
   */
  const carded = new Set(groupRegions.flatMap(r => r.members));
  const flat = rows.filter(r => !carded.has(r.id));

  const dragStart = (e: React.DragEvent, id: string) => {
    // Dragging a selected card drags the whole selection; dragging an unselected
    // one drags just it, without disturbing the selection.
    const ids = selected.has(id) ? [...selected] : [id];
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const card = (row: LeanAnimeRow, inGroupCard: boolean) => {
    const groups = groupsByAnime.get(row.id);
    const isSelected = selected.has(row.id);
    return (
      <div
        key={`${inGroupCard ? 'g' : 'f'}-${row.id}`}
        className={`${styles.card} ${isSelected ? styles.cardOn : ''}`}
        draggable
        onDragStart={e => dragStart(e, row.id)}
        onClick={e => onToggleSelect(row.id, e.shiftKey)}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleSelect(row.id, e.shiftKey); } }}
      >
        {row.picture ? (
          <Image src={row.picture} alt="" width={32} height={45} className={styles.poster} unoptimized />
        ) : (
          <span className={styles.poster} aria-hidden="true" />
        )}
        <span className={styles.text}>
          <span className={styles.cardTitle}>{row.title}</span>
          <span className={styles.meta}>
            {row.year ?? '—'}
            {row.score ? ` · ${row.score}/10` : ''}
            {/* A grouped title standing alone — its siblings filtered out, or
                only one of them present. The chip opens the blade, which is the
                third of the three placements a group gets. */}
            {!inGroupCard && groups?.length ? (
              <button
                type="button"
                className={styles.chip}
                onClick={e => { e.stopPropagation(); onOpenGroup(groups[0]); }}
                title={groups.map(g => g.name).join(', ')}
              >
                ⛓ {groups[0].name}
              </button>
            ) : null}
          </span>
        </span>

        <span className={styles.acts}>
          {variant === 'source' && (
            <>
              <button type="button" className={styles.act} title={t('quickEdit.add')}
                onClick={e => { e.stopPropagation(); onAdd?.([row.id]); }}>+</button>
              <button type="button" className={styles.act} title={t('quickEdit.exclude')}
                onClick={e => { e.stopPropagation(); onExclude?.([row.id]); }}>⊘</button>
            </>
          )}
          {variant === 'box' && (
            <button type="button" className={styles.act} title={t('quickEdit.remove')}
              onClick={e => { e.stopPropagation(); onRemove?.([row.id]); }}>−</button>
          )}
          {/* Every card can start a group: the relation component is fetched on
              open, so this costs nothing until clicked. */}
          <button type="button" className={styles.act} title={t('quickEdit.group')}
            onClick={e => { e.stopPropagation(); onCreateGroup(row.id); }}>⛓</button>
        </span>
      </div>
    );
  };

  return (
    <section
      className={`${styles.pane} ${dragOver ? styles.paneDrop : ''}`}
      onDragOver={e => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (raw) onDropIds(JSON.parse(raw) as string[]);
      }}
    >
      {/* ⚠️ The header AND the children pin together, in one sticky block.
          `{children}` is the source pane's picker, and the pane is the
          scrollport — so a sticky header with a static picker under it scrolled
          the field out of reach after one flick of the ~600-row list, leaving a
          pinned title above a list with no way to add to it. Found on screen:
          the field measured at y = -151 with the header still at the top. */}
      <div className={styles.top}>
        <header className={styles.head}>
          <h3 className={styles.title}>{title}</h3>
          <span className={styles.count}>{rows.length}</span>
        </header>

        {children}
      </div>

      {groupRegions.length > 0 && (
        <div className={styles.region}>
          <p className={styles.regionLabel}>{t('quickEdit.groupsRegion')}</p>
          {groupRegions.map(({ group, members }) => {
            const expanded = open.has(group.id);
            return (
              <div key={group.id} className={`${styles.group} ${variant === 'box' ? styles.groupOn : ''}`}>
                <div className={styles.groupHead}>
                  <button type="button" className={styles.chev} onClick={() => toggleOpen(group.id)}
                    aria-expanded={expanded} title={t('quickEdit.expandGroup')}>
                    {expanded ? '▾' : '▸'}
                  </button>
                  {/* Stacked posters: the card has to read as ONE show at a
                      glance, or the region is just a list with extra steps. */}
                  <span className={styles.stack}>
                    {members.slice(0, 4).map((id, i) => {
                      const row = byId.get(id);
                      return row?.picture ? (
                        <Image key={id} src={row.picture} alt="" width={26} height={37}
                          className={styles.stackPoster} style={{ left: i * 14 }} unoptimized />
                      ) : null;
                    })}
                  </span>
                  <button type="button" className={styles.groupName} onClick={() => onOpenGroup(group)}>
                    {group.name}
                  </button>
                  <span className={styles.groupCount}>
                    {variant === 'source'
                      // « 4 restants » — in the source pane the card counts what
                      // is NOT filed yet, which is the number the click acts on.
                      ? t('quickEdit.remaining', { count: members.length })
                      : t('quickEdit.present', { count: members.length })}
                  </span>
                </div>

                {/* The action sits on its OWN line. Beside the name it squeezed
                    it to « Dem… » in the box pane — a group card whose one job is
                    to say which show this is cannot afford to truncate the name,
                    and both labels are long by necessity. */}
                <div className={styles.groupActs}>
                  {variant === 'source' && (
                    // ⚠️ "Add all N" writes BOTH — the ids into `members` and the
                    // group id into `groups`. One click, both effects, so the
                    // ordinary path still feels automatic (§4).
                    <button type="button" className={styles.groupAct}
                      onClick={() => onAdd?.(members)}>
                      {t('quickEdit.addAll', { count: members.length })}
                    </button>
                  )}

                  {/* ⚠️ Every card in the BOX pane is a DECLARED group, so the
                      only action here is to stop declaring it. An undeclared
                      group whose members happen to be in the box is offered as a
                      nudge ABOVE the pane instead — putting it in this region
                      would break what the region means (§6.2: it is a picture of
                      how the ranker sees the box, and an undeclared group casts
                      no collapsed vote). */}
                  {variant === 'box' && (
                    <button type="button" className={styles.groupAct} onClick={() => onUndeclare?.(group.id)}>
                      {t('quickEdit.undeclare')}
                    </button>
                  )}
                </div>

                {expanded && (
                  <div className={styles.groupBody}>
                    {members.map(id => { const row = byId.get(id); return row ? card(row, true) : null; })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.region}>
        {groupRegions.length > 0 && <p className={styles.regionLabel}>{t('quickEdit.flatRegion')}</p>}
        {flat.length === 0 ? (
          <p className={styles.empty}>{t('quickEdit.paneEmpty')}</p>
        ) : (
          flat.map(row => card(row, false))
        )}
      </div>
    </section>
  );
};

export default QuickEditPane;
