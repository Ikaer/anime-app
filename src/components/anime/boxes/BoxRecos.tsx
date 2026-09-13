import React, { useCallback, useEffect, useState } from 'react';
import AnimeCardView from '../AnimeCardView';
import AnimeListHeader from '../AnimeListHeader';
import { useT } from '@/lib/i18n';
import type { AnimeRecord, RecoMeta } from '@/models/anime';
import styles from './BoxRecos.module.css';

/**
 * The box's recos tab — and the sharpest change in the revamp (§6.3).
 *
 * The engine is unchanged: `computeAnchored` over the box, through
 * `/api/anime/recommendations/mix?box=`. What changes is the QUESTION.
 *
 * ⚠️ **`includeSeen` defaults ON here**, the opposite of `/mix` and of the page
 * this replaces. With already-watched titles left in the feed, each card stops
 * being a watch suggestion and becomes a question about the box — « Oui, c'est
 * ça » files it, « Non » sets it aside — and both answers remove it from the
 * list. That turns this tab into a LABELING surface, and it is the only fill
 * mechanism that works for a FORM axis: the grow ranker is metadata-only and no
 * catalog field encodes form, while the crowd graph encodes tone even though no
 * field does. Measured during design: eight deliberately-weird titles shared
 * only `Philosophy` and exactly one T1 credit, and the metadata ranking drifted
 * to Death Note and Monster.
 *
 * **The checkbox stays; only its default flipped.** Once a box is well labeled,
 * `includeSeen` off is genuinely what you want — actual suggestions — and that
 * is a different, later question rather than a worse one.
 *
 * ⚠️ **« Non » is box-local and never reaches the global feed** (§3). It is not
 * a 👎, not a hide and not a seed mute: a title set aside from `Absolute cinema`
 * says nothing about `/recommendations`. `AnimeCardView` takes these through
 * `onBoxVerdict` for exactly that reason, never through `onFeedback`.
 *
 * It renders `AnimeListHeader`, which is also the fix for §1's last live bug:
 * the v1 tab had no cards-per-row control, so its feed rendered two cards wide
 * at the 1280px TV target.
 */
export interface BoxRecosProps {
  boxId: string;
  includeSeen: boolean;
  onIncludeSeenChange: (value: boolean) => void;
  cardsPerRow: number | null;
  onCardsPerRowChange: (value: number | null) => void;
  /** Files (`yes`) or sets aside (`no`); the page reloads the box afterwards. */
  onVerdict: (animeId: string, verdict: 'yes' | 'no') => Promise<void>;
  /** Bumped by the page whenever membership changes, so the feed re-ranks. */
  reloadToken: number;
}

type FeedCard = AnimeRecord & { recoMeta: RecoMeta };

const BoxRecos: React.FC<BoxRecosProps> = ({
  boxId, includeSeen, onIncludeSeenChange, cardsPerRow, onCardsPerRowChange, onVerdict, reloadToken,
}) => {
  const t = useT();
  const [feed, setFeed] = useState<FeedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /**
   * Cards answered in this session, hidden immediately.
   *
   * The write is real and the box reloads, but a « oui » lands the title in
   * `members` — which does not remove it from a feed built with `includeSeen`
   * on, because it is still a crowd neighbour of the box. Answering a question
   * has to make it go away, or the tab is a list that never shortens.
   */
  const [answered, setAnswered] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/anime/recommendations/mix?box=${encodeURIComponent(boxId)}` +
          (includeSeen ? '&includeSeen=true' : ''))
      .then(res => { if (!res.ok) throw new Error('mix'); return res.json(); })
      .then((data: { animes?: FeedCard[] }) => { if (!cancelled) { setFeed(data.animes ?? []); setError(''); } })
      .catch(() => { if (!cancelled) setError(t('boxes.loadError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boxId, includeSeen, reloadToken, t]);

  // A fresh feed is a fresh set of questions.
  useEffect(() => { setAnswered(new Set()); }, [boxId, includeSeen]);

  const verdict = useCallback(async (animeId: string, value: 'yes' | 'no') => {
    setAnswered(prev => new Set(prev).add(animeId));
    await onVerdict(animeId, value);
  }, [onVerdict]);

  const visible = feed.filter(a => !answered.has(a.id));

  return (
    <>
      <AnimeListHeader
        title={t('boxReco.title')}
        // `<= 1`: French takes the singular at zero too.
        count={visible.length <= 1
          ? t('boxReco.countOne', { count: visible.length })
          : t('boxReco.count', { count: visible.length })}
        display={{ cardsPerRow, onCardsPerRowChange }}
      >
        <label className={styles.seen}>
          <input type="checkbox" checked={includeSeen} onChange={e => onIncludeSeenChange(e.target.checked)} />
          {t('boxReco.includeSeen')}
        </label>
      </AnimeListHeader>

      <p className={styles.hint}>
        {includeSeen ? t('boxReco.labelHint') : t('boxReco.watchHint')}
      </p>

      {error && <p className={styles.error}>{error}</p>}
      {loading ? (
        <p className={styles.note}>{t('common.loading')}</p>
      ) : (
        <AnimeCardView
          animes={visible}
          cardsPerRow={cardsPerRow}
          // ⚠️ `feedbackMode` stays null: the 👍/👎 write the GLOBAL feedback
          // store, and a verdict about one taste axis must not re-rank « Pour
          // toi ». These buttons are the box's own.
          feedbackMode={null}
          onBoxVerdict={verdict}
        />
      )}
    </>
  );
};

export default BoxRecos;
