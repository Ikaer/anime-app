import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import AnimePicker from '../AnimePicker';
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
  /** Rename / re-emoji / re-describe; blur saves. */
  onPatch: (patch: { name?: string; emoji?: string; description?: string | null }) => void;
  onAdd: (animeId: string) => void;
  /**
   * Remove a whole UNIT — every id the slot stands for.
   *
   * ⚠️ Not just the faced title: a slot marked « +6 » represents seven entries,
   * so dropping one would leave six behind and simply re-face the slot, which
   * reads as a control that did nothing.
   */
  onRemove: (animeIds: string[]) => void;
  /** Where « Tout afficher » and the empty-box CTA lead. */
  href: string;
}

const BoxCard: React.FC<BoxCardProps> = ({ box, onPatch, onAdd, onRemove, href }) => {
  const t = useT();
  const [picking, setPicking] = useState(false);

  // French inflects on BOTH halves independently, and a constructed key would
  // need a `TranslationKey` cast — which is exactly the cast that disables the
  // missing-key compile check. Separate keys, chosen by ternary.
  // `<= 1`, not `=== 1`: French takes the singular at zero as well, and half the
  // boxes are empty, so « 0 séries · 0 entrées » was on half this page.
  const countKey: TranslationKey =
    box.count <= 1 ? 'boxes.entriesOne'
    : box.unitCount === 1 ? 'boxes.countOne'
    : 'boxes.count';

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <input
          className={styles.emoji}
          defaultValue={box.emoji}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== box.emoji) onPatch({ emoji: v }); }}
          aria-label={t('boxes.namePlaceholder')}
          maxLength={4}
        />
        <div className={styles.identity}>
          <input
            className={styles.name}
            defaultValue={box.name}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== box.name) onPatch({ name: v }); }}
            placeholder={t('boxes.namePlaceholder')}
            aria-label={t('boxes.namePlaceholder')}
          />
          <textarea
            className={styles.desc}
            defaultValue={box.description ?? ''}
            rows={1}
            // Blank CLEARS, unlike the name which falls back: a box must always
            // have a name and must be allowed to have no description.
            onBlur={e => {
              const v = e.target.value.trim();
              if (v !== (box.description ?? '')) onPatch({ description: v || null });
            }}
            placeholder={t('boxes.descShort')}
            aria-label={t('boxes.descPlaceholder')}
          />
          <div className={styles.meta}>
            <span className={styles.count}>
              {t(countKey, { units: box.unitCount, entries: box.count })}
            </span>
            {box.groups?.length ? <span>{t('boxes.declared', { count: box.groups.length })}</span> : null}
            {box.excludedCount ? <span>{t('boxes.excluded', { count: box.excludedCount })}</span> : null}
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={() => setPicking(p => !p)}>
            {picking ? t('boxes.addClose') : `+ ${t('boxes.add')}`}
          </button>
          {/* ⚠️ **Always rendered, never conditional on truncation.** This link was
              behind `box.count > box.top.length`, so a box whose strip already
              shows everything had NO route to its own detail page — 9 of the 13
              non-empty boxes on the live store, since the strip holds ten units
              and most boxes are smaller than that. The empty ones had their CTA
              and the four big ones had this, so the whole middle was a dead end.
              The label still says which case you are in. */}
          <Link href={href} className={styles.btn}>
            {box.count > box.top.length ? t('boxes.showAll') : t('boxes.open')}
          </Link>
        </div>
      </div>

      {/* Revealed by the `+` rather than always mounted: 26 always-live search
          inputs on one page is 26 debounce timers and a wall of chrome. */}
      {picking && (
        <div className={styles.picker}>
          <AnimePicker
            picked={new Set(box.members)}
            onPick={hit => onAdd(hit.id)}
            autoFocus
          />
        </div>
      )}

      {box.count === 0 ? (
        <div className={styles.empty}>
          {t('boxes.emptyBox')}
          <Link href={href} className={`${styles.btn} ${styles.emptyAction}`}>
            {t('boxes.emptyBoxAction')}
          </Link>
        </div>
      ) : (
        <div className={styles.strip}>
          {box.top.map(entry => (
            <div key={entry.row.id} className={styles.slot}>
              {/* A collapsed unit is ringed, not just badged: « +6 » is 10px of
                  text in a corner, and "which of these ten slots is one show and
                  which is one entry" is the question the whole revamp is about. */}
              <div className={`${styles.thumb} ${entry.extra > 0 ? styles.thumbUnit : ''}`}>
                <Link href={`/anime/${entry.row.id}`} title={entry.row.title}>
                  {entry.row.picture ? (
                    <Image
                      src={entry.row.picture}
                      alt=""
                      width={74}
                      height={105}
                      className={styles.poster}
                      unoptimized
                    />
                  ) : (
                    <span className={styles.poster} aria-hidden="true" />
                  )}
                </Link>
                {entry.extra > 0 && (
                  <span className={styles.extra}>{t('boxes.plus', { count: entry.extra })}</span>
                )}
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => onRemove(entry.members)}
                  aria-label={t('boxes.remove', { title: entry.row.title })}
                  title={t('boxes.remove', { title: entry.row.title })}
                >
                  ×
                </button>
              </div>
              <span className={styles.slotTitle}>{entry.row.title}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default BoxCard;
