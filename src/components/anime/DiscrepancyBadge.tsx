import React from 'react';
import styles from './DiscrepancyBadge.module.css';
import type { AnimeRecord, ProvenanceSource, ProviderPersonalState, UserAnimeStatus } from '@/models/anime';
import { useT, type TranslationKey, type TFunction } from '@/lib/i18n';

/**
 * Card/table badge summarizing a cross-provider personal-state mismatch
 * Provider-neutral: it walks whatever providers the
 * discrepancy carries — MAL, SIMKL, local, AniList — instead of the
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

  // No mismatch — a subtle "the merge is visible" chip naming the provider whose
  // value won, so the displayed state never looks like it came from nowhere.
  //
  // Reads the MERGED `personal` block and its provenance, not a raw slice (E7).
  // It used to hardcode `sources.simkl`, which contradicted this component's own
  // provider-neutral premise two lines up and left an AniList-only or local-only
  // user with no chip at all — the same "one surface looks empty without SIMKL"
  // shape C1 (docs/DECISIONS.md) removed from the card's status badge.
  if (!d) {
    const { status, score } = anime.personal;
    const winner = anime.provenance.personal.status ?? anime.provenance.personal.score;
    if (!winner || (!status && !score)) return null;
    const parts = [fmtStatus(t, status)];
    if (score) parts.push(`★${score}`);
    return (
      <span className={styles.badge} title={t('disc.syncedFrom', { provider: providerLabel(t, winner) })}>
        <span className={`${styles.chip} ${styles.info}`}>{providerLabel(t, winner)}: {parts.join(' ')}</span>
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
