import React, { useMemo, useState } from 'react';
import type { RecoMeta } from '@/models/anime';
import { useT } from '@/lib/i18n';
import styles from './RecoSeedsSection.module.css';

/** A muted seed as the feed endpoint reports it (id + already-localized title). */
export interface MutedSeed {
  id: string;
  title: string;
}

interface RecoSeedsSectionProps {
  /** The feed as currently rendered — the source of the active-seed tally. */
  metas: RecoMeta[];
  muted: MutedSeed[];
  onMute: (seedId: string) => void;
  onUnmute: (seedId: string) => void;
}

/** How many active seeds to list before the "show all" toggle. */
const COLLAPSED_LIMIT = 8;

/**
 * How many of the ranked cards the tally covers.
 *
 * ⚠️ **Not the whole feed, deliberately.** Seed concentration is a top-of-feed
 * phenomenon and washes out completely at full length — measured on the live
 * store, the leading seed holds 15% of the top 20, 8% of the top 50 and 1% of
 * all 968 candidates, and over the full feed the titles actually crowding the
 * top no longer even place in the top five. Tallying everything would rank the
 * merely-prolific seeds above the ones dominating what the reader is looking
 * at, which is the exact question this section exists to answer.
 */
const TALLY_WINDOW = 50;

/**
 * « Sources » — which of the owner's own titles the visible feed is being built
 * from, and a switch to stop building from any of them.
 *
 * **The tally is computed from the feed the reader is looking at**, not from the
 * whole seed set: 291 titles have crowd edges, but the question this section
 * answers is "why does my screen look like this", so it counts only seeds that
 * actually surfaced a card here. A seed that drives nothing visible is not a
 * useful row — and it disappears from the list on its own once muted, which is
 * the feedback that tells the reader the mute worked.
 *
 * It reads `topSeeds` (the top 2 backers per candidate) rather than the full
 * seed list, deliberately: `totalSeeds` counts every seed with an edge into a
 * candidate, which on a popular title is dozens, and attributing a card equally
 * to all of them would flatten the ranking this list exists to expose.
 */
const RecoSeedsSection: React.FC<RecoSeedsSectionProps> = ({ metas, muted, onMute, onUnmute }) => {
  const t = useT();
  const [showAll, setShowAll] = useState(false);

  const active = useMemo(() => {
    const counts = new Map<string, { id: string; title: string; count: number; lead: number }>();
    for (const meta of metas.slice(0, TALLY_WINDOW)) {
      meta.topSeeds.forEach((seed, rank) => {
        const row = counts.get(seed.id) ?? { id: seed.id, title: seed.title, count: 0, lead: 0 };
        row.count += 1;
        // `lead` = cards this seed is the PRIMARY backer of. It is what the
        // reader perceives as "this title keeps deciding my feed", so it breaks
        // ties ahead of the raw appearance count.
        if (rank === 0) row.lead += 1;
        counts.set(seed.id, row);
      });
    }
    return [...counts.values()].sort((a, b) => b.lead - a.lead || b.count - a.count);
  }, [metas]);

  const shown = showAll ? active : active.slice(0, COLLAPSED_LIMIT);

  return (
    <div className={styles.section}>
      <p className={styles.blurb}>{t('reco.seeds.blurb', { count: Math.min(metas.length, TALLY_WINDOW) })}</p>

      {active.length === 0 ? (
        <p className={styles.empty}>{t('reco.seeds.none')}</p>
      ) : (
        <ul className={styles.list}>
          {shown.map(seed => (
            <li key={seed.id} className={styles.row}>
              <span className={styles.seedTitle} title={seed.title}>{seed.title}</span>
              <span className={styles.count} title={t('reco.seeds.leadCount', { count: seed.lead })}>
                {seed.lead}
              </span>
              <button
                type="button"
                className={styles.muteButton}
                onClick={() => onMute(seed.id)}
                title={t('reco.muteSeedTitle', { title: seed.title })}
                aria-label={t('reco.muteSeedTitle', { title: seed.title })}
              >
                ⊘
              </button>
            </li>
          ))}
        </ul>
      )}

      {active.length > COLLAPSED_LIMIT && (
        <button type="button" className={styles.more} onClick={() => setShowAll(v => !v)}>
          {showAll
            ? t('reco.seeds.showLess')
            : t('reco.seeds.showAll', { count: active.length - COLLAPSED_LIMIT })}
        </button>
      )}

      {muted.length > 0 && (
        <div className={styles.mutedBlock}>
          <div className={styles.mutedHead}>{t('reco.seeds.mutedHead', { count: muted.length })}</div>
          <ul className={styles.list}>
            {muted.map(seed => (
              <li key={seed.id} className={styles.row}>
                <span className={`${styles.seedTitle} ${styles.mutedTitle}`} title={seed.title}>{seed.title}</span>
                <button
                  type="button"
                  className={styles.unmuteButton}
                  onClick={() => onUnmute(seed.id)}
                  title={t('reco.unmuteSeedTitle', { title: seed.title })}
                  aria-label={t('reco.unmuteSeedTitle', { title: seed.title })}
                >
                  ↩
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default RecoSeedsSection;
