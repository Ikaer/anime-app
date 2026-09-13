import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { PreviewRow } from '@/lib/reco/profilePreview';
import type { RankShift } from '@/lib/reco/profileBaseline';
import { isStaffFamily } from '@/lib/reco/staffFields';
import { useT, type TranslationKey } from '@/lib/i18n';
import styles from './ProfilePreviewList.module.css';

/**
 * The preview ranking, row by row AGAINST `Défaut` — never on its own
 * (`reco/profileBaseline.ts` has the why: a bare catalog rank would be a fourth
 * recommendation surface). Each row carries its shift badge, and the reason it
 * is here, families first: a craft hit is the thing being tuned.
 *
 * Rows, not cards: this is an instrument read top to bottom while a slider
 * moves, and a 30-row list has to fit beside the sliders at the TV's ~1280px.
 */

/** Reasons shown per row — enough to see what moved it, not the whole explain. */
const WHY_LIMIT = 3;
/** Values shown per reason. */
const VALUE_LIMIT = 3;

export interface ProfilePreviewListProps {
  items: PreviewRow[];
  shifts: RankShift[];
}

const ProfilePreviewList: React.FC<ProfilePreviewListProps> = ({ items, shifts }) => {
  const t = useT();
  const label = (field: string) => t(`reco.source.${field}.label` as TranslationKey);

  const why = (item: PreviewRow): { key: string; family: boolean; text: string }[] => {
    if (item.matched) {
      return [...item.matched]
        // A family first, then the order the ranker gave (strongest field first).
        .sort((a, b) => Number(isStaffFamily(b.field)) - Number(isStaffFamily(a.field)))
        .slice(0, WHY_LIMIT)
        .map(m => ({
          key: m.field,
          family: isStaffFamily(m.field),
          // `anilistStaff` matches on AniList staff IDS — right for the math,
          // unreadable in a row — so it states the field alone.
          text: m.field === 'anilistStaff' || m.values.length === 0
            ? label(m.field)
            : `${label(m.field)} : ${m.values.slice(0, VALUE_LIMIT).join(', ')}`,
        }));
    }
    return (item.breakdown ?? [])
      .filter(c => c.contribution > 0)
      .sort((a, b) => Number(isStaffFamily(b.source)) - Number(isStaffFamily(a.source)))
      .slice(0, WHY_LIMIT)
      .map(c => ({
        key: c.source,
        family: isStaffFamily(c.source),
        text: `${label(c.source)} +${c.contribution.toFixed(2)}${c.detail ? ` — ${c.detail}` : ''}`,
      }));
  };

  const badge = (shift: RankShift | undefined) => {
    if (!shift || shift.kind === 'same') return <span className={`${styles.shift} ${styles.same}`}>=</span>;
    if (shift.kind === 'new') return <span className={`${styles.shift} ${styles.new}`}>{t('profiles.shift.new')}</span>;
    return (
      <span className={`${styles.shift} ${shift.kind === 'up' ? styles.up : styles.down}`}>
        {shift.kind === 'up' ? '▲' : '▼'}{shift.by}
      </span>
    );
  };

  return (
    <ol className={styles.list}>
      {items.map((item, i) => (
        <li key={item.row.id} className={styles.item}>
          <span className={styles.rank}>{i + 1}</span>
          {badge(shifts[i])}
          <Link href={`/anime/${item.row.id}`} className={styles.posterLink} title={item.row.title}>
            {item.row.picture
              ? <Image src={item.row.picture} alt="" width={40} height={57} className={styles.poster} unoptimized />
              : <span className={styles.poster} aria-hidden="true" />}
          </Link>
          <div className={styles.body}>
            <div className={styles.titleLine}>
              <Link href={`/anime/${item.row.id}`} className={styles.title}>{item.row.title}</Link>
              {item.ids.length > 1 && (
                <span className={styles.franchise} title={t('profiles.franchiseHint')}>
                  {t('boxes.plus', { count: item.ids.length - 1 })}
                </span>
              )}
            </div>
            <div className={styles.meta}>
              {item.row.year ?? '—'}
              {item.row.mean ? ` · ★ ${item.row.mean.toFixed(2)}` : ''}
              {item.row.status ? ` · ${t(`statusShort.${item.row.status}` as TranslationKey)}` : ''}
              <span className={styles.score}>{item.score.toFixed(2)}</span>
            </div>
            <ul className={styles.why}>
              {why(item).map(w => (
                <li key={w.key} className={w.family ? styles.whyFamily : undefined}>{w.text}</li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
};

export default ProfilePreviewList;
