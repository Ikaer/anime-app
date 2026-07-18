import React from 'react';
import styles from './DiscrepancyBadge.module.css';
import type { AnimeRecord, ProvenanceSource, ProviderPersonalState, UserAnimeStatus } from '@/models/anime';
import { useT, type TranslationKey, type TFunction } from '@/lib/i18n';

/**
 * Card/table badge summarizing a cross-provider personal-state mismatch
 * (docs/localRating/ phase 4). Provider-neutral: it walks whatever providers the
 * discrepancy carries — MAL, SIMKL, local, later Betaseries — instead of the
 * fixed MAL-vs-SIMKL glyph it started as.
 */

const fmtStatus = (t: TFunction, s: UserAnimeStatus | undefined): string =>
  s ? t(`statusShort.${s}` as TranslationKey) : '—';

const providerLabel = (t: TFunction, p: ProvenanceSource): string =>
  t(`disc.provider.${p}` as TranslationKey);

interface Props {
  anime: AnimeRecord;
}

const DiscrepancyBadge: React.FC<Props> = ({ anime }) => {
  const t = useT();
  const d = anime.discrepancy;

  // No mismatch, but the title IS synced from SIMKL -> subtle "merge is visible"
  // chip so the user can see SIMKL's own status/score even when it agrees.
  if (!d) {
    if (!anime.sources.simkl) return null;
    const parts = [fmtStatus(t, anime.sources.simkl.status)];
    if (anime.sources.simkl.score != null) parts.push(`★${anime.sources.simkl.score}`);
    return (
      <span className={styles.badge} title={t('disc.syncedFromSimkl')}>
        <span className={`${styles.chip} ${styles.info}`}>SIMKL: {parts.join(' ')}</span>
      </span>
    );
  }

  const entries = (Object.entries(d.providers) as [ProvenanceSource, ProviderPersonalState][])
    .filter(([, s]) => s.present);

  // One chip per disagreeing dimension, listing each provider's own value —
  // "MAL 7 · SIMKL 8 · Local 8" rather than the old two-sided "7 / 8".
  const chip = (render: (s: ProviderPersonalState) => string) =>
    entries.map(([p, s]) => `${providerLabel(t, p)} ${render(s)}`).join(' · ');

  return (
    <span className={styles.badge} title={t('disc.mismatch')}>
      {d.disagree.status && (
        <span className={`${styles.chip} ${styles.mismatch}`}>{chip(s => fmtStatus(t, s.status))}</span>
      )}
      {d.disagree.score && (
        <span className={`${styles.chip} ${styles.mismatch}`}>{chip(s => `★${s.score || '—'}`)}</span>
      )}
      {d.disagree.progress && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          {chip(s => `${s.progress ?? '—'}`)} {t('disc.episodesShort')}
        </span>
      )}
      {d.presence && (
        <span className={`${styles.chip} ${styles.presence}`}>
          {t('disc.absentFrom', { providers: d.presence.absent.map(p => providerLabel(t, p)).join(', ') })}
        </span>
      )}
    </span>
  );
};

export default DiscrepancyBadge;
