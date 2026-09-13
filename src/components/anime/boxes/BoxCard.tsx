import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { BoxSummary } from '@/pages/api/anime/boxes';
import styles from './BoxCard.module.css';

/**
 * One box on `/boxes` — the box-first inversion that is the point of the
 * revamp.
 *
 * The old landing asked an O(titles × boxes) question: 473 franchise groups, a
 * 26-chip row under each, 12,298 cells. Nobody answers that 473 times, and the
 * measurement says so — 108 of 720 watched titles (15%) filed anywhere, 13 of 26
 * boxes still empty after two labeling sessions. Here the page is a list of
 * BOXES, and each says what it holds.
 *
 * Three details carry most of the value:
 *
 * ⚠️ **The strip is a top ten of UNITS, not of entries.** By entry, `Shonen I
 * dig`'s top ten is seven Demon Slayer cours and three other things — §1's
 * inflation rendered as a summary, on the one surface whose job is to say what
 * the box IS. Each slot is faced by its unit's best-scored member and marked
 * « +6 ». This is the one place the collapse is applied for display without a
 * groups region beside it: a card has room for a list, not for two regions.
 *
 * **The count is honest: « 3 séries · 14 entrées ».** Units alongside raw
 * entries, so the inflation is visible per box and therefore fixable by
 * judgement. ⚠️ Which is also why there is no migration to collapse existing
 * memberships — `user/boxes.json` is durable user data and the four TYBW cours
 * may well be deliberate.
 *
 * **An empty box renders a CTA, not a blank card.** Half the boxes are empty, so
 * a render-what-is-there rule would make half this page nothing at all.
 *
 * Ordering inside the strip is personal score desc, then insertion order — score
 * alone barely orders anything (`Unique vibe` is nine 10s), and "what I filed
 * first" is a serviceable proxy for "best example". Cheap, stable, no new state.
 */
export interface BoxCardProps {
  box: BoxSummary;
  /** The box's présentation — where the header and the overflow tile lead. */
  href: string;
  /** The box in edition mode — where « Éditer » and the empty-box CTA lead. */
  editHref: string;
}

/**
 * ⚠️ **Navigation only — nothing on this card edits.** It used to carry
 * in-place name/emoji/description fields, a « + Ajouter » picker and a × on
 * every poster, which made the landing page read as a form and made a stray
 * click a write. Every edit now lives in the box's edition mode, one click
 * away through « Éditer »; the card's header goes to the présentation, and each
 * poster to its anime.
 */
const BoxCard: React.FC<BoxCardProps> = ({ box, href, editHref }) => {
  const t = useT();

  // French inflects on BOTH halves independently, and a constructed key would
  // need a `TranslationKey` cast — which is exactly the cast that disables the
  // missing-key compile check. Separate keys, chosen by ternary.
  // `<= 1`, not `=== 1`: French takes the singular at zero as well, and half the
  // boxes are empty, so « 0 séries · 0 entrées » was on half this page.
  const countKey: TranslationKey =
    box.count <= 1 ? 'boxes.entriesOne'
    : box.unitCount === 1 ? 'boxes.countOne'
    : 'boxes.count';

  /**
   * The strip is one row of ten slots. ⚠️ When units are left out, the « +N »
   * tile TAKES the tenth slot rather than being an eleventh: an eleventh wraps
   * onto a line of its own, a whole poster row's height spent on one tile.
   */
  const overflow = box.unitCount > box.top.length;
  const shown = overflow ? box.top.slice(0, box.top.length - 1) : box.top;
  const hidden = box.unitCount - shown.length;

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        {/* The whole identity block is the link, not just the name: it is the
            biggest target on the card and the one the eye lands on. */}
        <Link href={href} className={styles.identityLink}>
          <span className={styles.emoji} aria-hidden="true">{box.emoji}</span>
          <span className={styles.identity}>
            <span className={styles.name}>{box.name}</span>
            {box.description && <span className={styles.desc}>{box.description}</span>}
            <span className={styles.meta}>
              <span className={styles.count}>
                {t(countKey, { units: box.unitCount, entries: box.count })}
              </span>
              {box.groups?.length ? (
                <span className={styles.metaSep}>
                  {box.groups.length === 1
                    ? t('boxes.declaredOne', { count: 1 })
                    : t('boxes.declared', { count: box.groups.length })}
                </span>
              ) : null}
              {box.excludedCount ? (
                <span className={styles.metaSep}>
                  {box.excludedCount === 1
                    ? t('boxes.excludedOne', { count: 1 })
                    : t('boxes.excluded', { count: box.excludedCount })}
                </span>
              ) : null}
            </span>
          </span>
        </Link>
        <div className={styles.actions}>
          <Link href={editHref} className={styles.btn}>
            ✎ {t('quickEdit.open')}
          </Link>
        </div>
      </div>

      {box.count === 0 ? (
        <div className={styles.empty}>
          {t('boxes.emptyBox')}
          <Link href={editHref} className={`${styles.btn} ${styles.btnPrimary}`}>
            ✎ {t('quickEdit.open')}
          </Link>
        </div>
      ) : (
        <div className={styles.strip}>
          {shown.map(entry => (
            <div key={entry.row.id} className={styles.slot}>
              {/* A collapsed unit is drawn as a stack, not just badged: « +6 » is
                  10px of text in a corner, and "which of these ten slots is one
                  show and which is one entry" is the question the whole revamp is
                  about. */}
              <Link
                href={`/anime/${entry.row.id}`}
                title={entry.row.title}
                className={`${styles.thumb} ${entry.extra > 0 ? styles.thumbUnit : ''}`}
              >
                {entry.row.picture ? (
                  <Image
                    src={entry.row.picture}
                    alt=""
                    width={84}
                    height={120}
                    className={styles.poster}
                    unoptimized
                  />
                ) : (
                  <span className={styles.poster} aria-hidden="true" />
                )}
                {entry.extra > 0 && (
                  <span className={styles.extra}>{t('boxes.plus', { count: entry.extra })}</span>
                )}
              </Link>
              <span className={styles.slotTitle}>{entry.row.title}</span>
            </div>
          ))}
          {/* The strip holds ten units; the rest are one click away rather than
              silently cut. */}
          {overflow && (
            <div className={styles.slot}>
              <Link href={href} className={`${styles.thumb} ${styles.more}`}>
                <span className={styles.moreCount}>{t('boxes.plus', { count: hidden })}</span>
              </Link>
              <span className={styles.slotTitle}>{t('boxes.showAll')}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default BoxCard;
