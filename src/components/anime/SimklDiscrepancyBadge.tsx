import React from 'react';
import styles from './SimklDiscrepancyBadge.module.css';
import type { AnimeForDisplay, UserAnimeStatus } from '@/models/anime';

const STATUS_LABEL: Record<UserAnimeStatus, string> = {
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Plan',
};

const fmtStatus = (s: UserAnimeStatus | null): string => (s ? STATUS_LABEL[s] : '—');

interface Props {
  anime: AnimeForDisplay;
}

const SimklDiscrepancyBadge: React.FC<Props> = ({ anime }) => {
  const d = anime.discrepancy;

  // No mismatch, but the title IS synced from SIMKL -> subtle "merge is visible"
  // chip so the user can see SIMKL's own status/score even when it agrees.
  if (!d) {
    if (!anime.simkl) return null;
    const parts = [fmtStatus(anime.simkl.status)];
    if (anime.simkl.score != null) parts.push(`★${anime.simkl.score}`);
    return (
      <span className={styles.badge} title="Synced from SIMKL">
        <span className={`${styles.chip} ${styles.info}`}>SIMKL: {parts.join(' ')}</span>
      </span>
    );
  }

  return (
    <span className={styles.badge} title="MAL vs SIMKL mismatch">
      {d.status && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          {fmtStatus(d.status.mal)} / {fmtStatus(d.status.simkl)}
        </span>
      )}
      {d.score && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          ★{d.score.mal ?? '—'} / ★{d.score.simkl ?? '—'}
        </span>
      )}
      {d.progress && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          {d.progress.mal ?? '—'} / {d.progress.simkl ?? '—'} ep
        </span>
      )}
      {d.presence && (
        <span className={`${styles.chip} ${styles.presence}`}>SIMKL only</span>
      )}
    </span>
  );
};

export default SimklDiscrepancyBadge;
