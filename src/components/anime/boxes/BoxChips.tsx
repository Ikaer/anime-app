import React from 'react';
import type { BoxSummary } from '@/pages/api/anime/boxes';
import styles from './BoxChips.module.css';

/**
 * The membership control: one toggle chip per box, under a franchise group.
 *
 * **Toggles, not drag-and-drop, and that is the whole design.** `/tier` uses drag
 * because a score is EXCLUSIVE — there is one destination and leaving the source
 * is the correct semantic. A title belongs to any number of boxes, so a card must
 * stay put after being filed; a "move" gesture would be lying about what happened,
 * the source list would never shrink to show progress, and filing 467 groups
 * across a few boxes would cost on the order of a thousand drags. A chip row
 * costs one click per (group, box) pair and reads its own state.
 *
 * `pending` covers the in-flight write: the chip shows its new state immediately
 * (the parent applies the change optimistically) but stays inert until the server
 * answers, so a double-click can't queue two conflicting writes for one pair.
 */
export interface BoxChipsProps {
  boxes: BoxSummary[];
  /** Box ids currently holding this group. */
  active: Set<string>;
  /** Box ids with a write in flight for this group. */
  pending?: Set<string>;
  onToggle: (boxId: string, next: boolean) => void;
  /** Rendered when no box exists yet — the empty state has to say what to do. */
  emptyHint?: React.ReactNode;
}

const BoxChips: React.FC<BoxChipsProps> = ({ boxes, active, pending, onToggle, emptyHint }) => {
  if (boxes.length === 0) return emptyHint ? <div className={styles.empty}>{emptyHint}</div> : null;

  return (
    <div className={styles.row}>
      {boxes.map(box => {
        const on = active.has(box.id);
        const busy = pending?.has(box.id) ?? false;
        return (
          <button
            key={box.id}
            type="button"
            className={`${styles.chip} ${on ? styles.on : ''} ${busy ? styles.busy : ''}`}
            aria-pressed={on}
            disabled={busy}
            onClick={() => onToggle(box.id, !on)}
            title={box.name}
          >
            {box.emoji && <span className={styles.emoji}>{box.emoji}</span>}
            <span className={styles.label}>{box.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export default BoxChips;
