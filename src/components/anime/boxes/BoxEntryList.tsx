import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useT } from '@/lib/i18n';
import type { LeanAnimeRow } from '@/lib/domain/leanRow';
import styles from './BoxEntryList.module.css';

/**
 * A box's entries as poster slots, each with exactly one action.
 *
 * Two tabs render through it — présentation (a slot per UNIT, `−` removes the
 * whole unit) and écartés (a slot per excluded id, `↩` puts it back) — because
 * they are the same list at different meanings, and forking them would fork the
 * geometry twice for one differing glyph.
 *
 * ⚠️ **A slot is a UNIT, so its action takes every id the slot stands for.**
 * Removing only the faced title of a « +6 » slot would leave six behind and
 * re-face the slot, which reads as a control that did nothing — the same rule
 * the landing card's × already follows.
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
  /** The glyph on the per-slot button — `−` in présentation, `↩` in écartés. */
  actionIcon: string;
  /** Tooltip and aria-label for that button, given the slot's title. */
  actionLabel: (title: string) => string;
  /** Called with every id the slot stands for. */
  onAct: (animeIds: string[]) => void;
}

const BoxEntryList: React.FC<BoxEntryListProps> = ({ entries, actionIcon, actionLabel, onAct }) => {
  const t = useT();
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const slot = (row: LeanAnimeRow, extra: number, expanded: boolean, entryId: string, act: () => void) => (
    <div className={styles.slot}>
      <div className={styles.thumb}>
        <Link href={`/anime/${row.id}`} title={row.title}>
          {row.picture ? (
            <Image src={row.picture} alt="" width={92} height={131} className={styles.poster} unoptimized />
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
        <button
          type="button"
          className={styles.act}
          onClick={act}
          aria-label={actionLabel(row.title)}
          title={actionLabel(row.title)}
        >
          {actionIcon}
        </button>
      </div>
      <span className={styles.slotTitle}>{row.title}</span>
      <span className={styles.slotMeta}>
        {row.year ?? '—'}
        {row.score ? ` · ${row.score}/10` : ''}
      </span>
    </div>
  );

  return (
    <div className={styles.grid}>
      {entries.map(entry => {
        const expanded = open.has(entry.row.id);
        return (
          <React.Fragment key={entry.row.id}>
            {slot(entry.row, entry.members.length - 1, expanded, entry.row.id,
              () => onAct(entry.members.map(m => m.id)))}
            {/* The unit's other entries, each acting on ITSELF — « TYBW oui,
                Bleach non » has to stay reachable, or a collapse would be a
                one-way decision. */}
            {expanded && entry.members.slice(1).map(member => (
              <div key={member.id} className={styles.child}>
                {slot(member, 0, false, member.id, () => onAct([member.id]))}
              </div>
            ))}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default BoxEntryList;
