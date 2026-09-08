import React, { useCallback, useEffect, useState } from 'react';
import type { BoxSummary, BoxListResponse } from '@/pages/api/anime/boxes';
import BoxChips from './BoxChips';
import styles from './BoxChips.module.css';
import { useT } from '@/lib/i18n';

/**
 * « Mes boîtes » for ONE title, on the anime detail page.
 *
 * **Why this is worth its own placement.** The chip grid on `/boxes` asks an
 * O(titles × boxes) question — 473 franchise groups × 26 boxes — and the
 * evidence that nobody answers it 473 times is that 108 of 720 watched titles
 * (15%) are filed anywhere at all, with 13 of the 26 boxes still empty after two
 * labeling sessions. The grid's one real strength is the *inverse* question,
 * "which boxes does THIS show belong to", and that question had no home. Asking
 * it here turns filing into a side-effect of browsing — at the moment you are
 * actually thinking "oh, that one made me cry" — instead of a chore with its own
 * route.
 *
 * ⚠️ **It files THE TITLE, never its franchise component.** `/boxes`' « Remplir »
 * added the whole relation component, which measured 487 of 1,539 proposed
 * entries (32%) being titles the owner had never watched. One card, one id.
 *
 * ⚠️ **Writes go through the incremental `add`/`remove`, never a `members`
 * replacement.** A full-set write is a read-modify-write on the client, and a
 * row of chips fires many of them against many boxes: two toggles sent before
 * the first response lands would make the second clobber the first. The
 * incremental form is applied server-side against the current file, so it can't.
 *
 * `BoxChips` stays presentational — this is the container that knows about the
 * network. Splitting them is what lets the chip row keep its `pending` contract
 * (a chip shows its new state at once but stays inert until the server answers,
 * so a double-click cannot queue two conflicting writes for one pair).
 */
export interface AnimeBoxChipsProps {
  /** The canonical id being filed. */
  animeId: string;
}

const AnimeBoxChips: React.FC<AnimeBoxChipsProps> = ({ animeId }) => {
  const t = useT();
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  // One fetch on mount, the `CastSection` idiom. `/api/anime/boxes` already
  // ships every box's member ids (a box is 20-40 ids, so the list is small),
  // which is what lets the active set be computed here rather than needing a
  // per-title endpoint of its own.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/anime/boxes')
      .then(res => { if (!res.ok) throw new Error('boxes'); return res.json(); })
      .then((data: BoxListResponse) => {
        if (cancelled) return;
        setBoxes(data.boxes);
        setActive(new Set(data.boxes.filter(b => b.members.includes(animeId)).map(b => b.id)));
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [animeId]);

  const onToggle = useCallback(async (boxId: string, next: boolean) => {
    if (pending.has(boxId)) return;
    setPending(prev => new Set(prev).add(boxId));
    // Optimistic: the chip is the whole interaction, so waiting a round trip to
    // show it landed makes filing feel like a form submission.
    setActive(prev => {
      const copy = new Set(prev);
      if (next) copy.add(boxId); else copy.delete(boxId);
      return copy;
    });
    try {
      const res = await fetch(`/api/anime/boxes/${encodeURIComponent(boxId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next ? { add: [animeId] } : { remove: [animeId] }),
      });
      if (!res.ok) throw new Error('write');
    } catch {
      // Revert, `/tier`'s rule: a write that did not land must not keep showing
      // as if it had, or the box quietly disagrees with what is on screen.
      setActive(prev => {
        const copy = new Set(prev);
        if (next) copy.delete(boxId); else copy.add(boxId);
        return copy;
      });
      setError(true);
    } finally {
      setPending(prev => { const copy = new Set(prev); copy.delete(boxId); return copy; });
    }
  }, [animeId, pending]);

  // Nothing at all until the fetch lands: an empty chip row that then fills in
  // reads as "this title is in no box", which is a different statement.
  if (!loaded) return null;

  return (
    <>
      <BoxChips
        boxes={boxes}
        active={active}
        pending={pending}
        onToggle={onToggle}
        emptyHint={t('detail.boxes.none')}
      />
      {error && <p className={styles.error}>{t('boxes.loadError')}</p>}
    </>
  );
};

export default AnimeBoxChips;
