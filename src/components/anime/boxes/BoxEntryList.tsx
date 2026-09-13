import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useT } from '@/lib/i18n';
import type { LeanAnimeRow } from '@/lib/domain/leanRow';
import styles from './BoxEntryList.module.css';

/**
 * A box's entries as poster slots, each with at most one action.
 *
 * Three places render through it — présentation (a slot per UNIT, read-only),
 * the écartés tab (a slot per excluded id, `↩` puts it back) and edition's
 * écartés strip — because they are the same list at different meanings, and
 * forking them would fork the geometry for one differing glyph.
 *
 * **Présentation is read-only on purpose**: its `−` went with the header's
 * in-place fields when editing moved into edition mode. Browsing a box should
 * never be one stray click from changing it.
 *
 * ⚠️ **A slot is a UNIT, so its action takes every id the slot stands for.**
 * Acting on only the faced title of a « +6 » slot would leave six behind and
 * re-face the slot, which reads as a control that did nothing — the same rule
 * the landing card's strip follows.
 *
 * A collapsed slot expands in place. That is what makes §6.1's « every member,
 * no Tout afficher » true rather than approximately true: the card's summary
 * view is honest about how many entries a slot covers, and this is where they
 * are actually reachable.
 */
export interface BoxEntry {
  /** The face — what the slot shows. */
  row: LeanAnimeRow;
  /** Everything the slot stands for, face first. One entry for a lone title. */
  members: LeanAnimeRow[];
}

export interface BoxEntryListProps {
  entries: BoxEntry[];
  /** The glyph on the per-slot button — `↩` on écartés. Omit for no action. */
  actionIcon?: string;
  /** Tooltip and aria-label for that button, given the slot's title. */
  actionLabel?: (title: string) => string;
  /** Called with every id the slot stands for. Omit for a read-only list. */
  onAct?: (animeIds: string[]) => void;
  /**
   * `large` (default) is the présentation's grid — the box's actual content,
   * so the posters are the page. `compact` is for a strip living under other
   * panes (edition's écartés), where the same size would crowd them out.
   */
  size?: 'large' | 'compact';
}

const BoxEntryList: React.FC<BoxEntryListProps> = ({ entries, actionIcon, actionLabel, onAct, size = 'large' }) => {
  const t = useT();
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const slot = (row: LeanAnimeRow, extra: number, expanded: boolean, entryId: string, act?: () => void) => (
    <div className={styles.slot}>
      {/* Stacked when the slot stands for a whole unit — the same signal the
          landing card gives, so a box reads the same way at both lengths. */}
      <div className={`${styles.thumb} ${extra > 0 ? styles.thumbUnit : ''}`}>
        <Link href={`/anime/${row.id}`} title={row.title} className={styles.posterLink}>
          {row.picture ? (
            <Image src={row.picture} alt="" width={230} height={326} className={styles.poster} unoptimized />
          ) : (
            <span className={styles.poster} aria-hidden="true" />
          )}
        </Link>
        {extra > 0 && (
          // The badge IS the disclosure: « +6 » states the number and clicking
          // it shows them, so there is no second affordance to find.
          <button
            type="button"
            className={`${styles.extra} ${expanded ? styles.extraOpen : ''}`}
            onClick={() => toggle(entryId)}
            aria-expanded={expanded}
            title={t('boxes.expandUnit', { count: extra + 1 })}
          >
            {t('boxes.plus', { count: extra })}
          </button>
        )}
        {act && actionIcon && (
          <button
            type="button"
            className={styles.act}
            onClick={act}
            aria-label={actionLabel?.(row.title)}
            title={actionLabel?.(row.title)}
          >
            {actionIcon}
          </button>
        )}
      </div>
      <span className={styles.slotTitle}>{row.title}</span>
      <span className={styles.slotMeta}>
        {row.year ?? '—'}
        {row.score ? ` · ${row.score}/10` : ''}
      </span>
    </div>
  );

  return (
    <div className={`${styles.grid} ${size === 'compact' ? styles.compact : ''}`}>
      {entries.map(entry => {
        const expanded = open.has(entry.row.id);
        return (
          <React.Fragment key={entry.row.id}>
            {slot(entry.row, entry.members.length - 1, expanded, entry.row.id,
              onAct && (() => onAct(entry.members.map(m => m.id))))}
            {/* The unit's other entries, each acting on ITSELF — « TYBW oui,
                Bleach non » has to stay reachable, or a collapse would be a
                one-way decision. */}
            {expanded && entry.members.slice(1).map(member => (
              <div key={member.id} className={styles.child}>
                {slot(member, 0, false, member.id, onAct && (() => onAct([member.id])))}
              </div>
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default BoxEntryList;
