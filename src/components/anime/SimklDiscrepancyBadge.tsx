import React from 'react';
import styles from './SimklDiscrepancyBadge.module.css';
import type { AnimeForDisplay, UserAnimeStatus } from '@/models/anime';
import { useT, type TranslationKey, type TFunction } from '@/lib/i18n';

const fmtStatus = (t: TFunction, s: UserAnimeStatus | null): string =>
  s ? t(`statusShort.${s}` as TranslationKey) : '—';

interface Props {
  anime: AnimeForDisplay;
}

const SimklDiscrepancyBadge: React.FC<Props> = ({ anime }) => {
  const t = useT();
  const d = anime.discrepancy;

  // No mismatch, but the title IS synced from SIMKL -> subtle "merge is visible"
  // chip so the user can see SIMKL's own status/score even when it agrees.
  if (!d) {
    if (!anime.simkl) return null;
    const parts = [fmtStatus(t, anime.simkl.status)];
    if (anime.simkl.score != null) parts.push(`★${anime.simkl.score}`);
    return (
      <span className={styles.badge} title={t('disc.syncedFromSimkl')}>
        <span className={`${styles.chip} ${styles.info}`}>SIMKL: {parts.join(' ')}</span>
      </span>
    );
  }

  return (
    <span className={styles.badge} title={t('disc.mismatch')}>
      {d.status && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          {fmtStatus(t, d.status.mal)} / {fmtStatus(t, d.status.simkl)}
        </span>
      )}
      {d.score && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          ★{d.score.mal ?? '—'} / ★{d.score.simkl ?? '—'}
        </span>
      )}
      {d.progress && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          {d.progress.mal ?? '—'} / {d.progress.simkl ?? '—'} {t('disc.episodesShort')}
        </span>
      )}
      {d.presence && (
        <span className={`${styles.chip} ${styles.presence}`}>{t('disc.simklOnly')}</span>
      )}
    </span>
  );
};

export default SimklDiscrepancyBadge;
