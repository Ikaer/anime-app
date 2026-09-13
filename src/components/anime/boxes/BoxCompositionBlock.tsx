import React from 'react';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { BoxComposition, CompositionValue } from '@/lib/domain/boxComposition';
import styles from './BoxCompositionBlock.module.css';

/**
 * « De quoi cette boîte est faite » — the block §6.1 adds to présentation.
 *
 * It is the honest answer to "what did I actually draw here", and it is also a
 * DIAGNOSIS: a box whose shared values are content values will project, so its
 * grow ranking is worth trusting; a box whose members share `Philosophy` and one
 * T1 credit is a form axis, no catalog field encodes form, and the ranker will
 * drift to whatever is merely adjacent. The two look identical until you see
 * what they have in common — which is why this sits above the member grid
 * rather than at the foot of the page.
 *
 * Every count is out of UNITS (`4/6`, not `4/14`), which is what stops seven
 * filed cours of one show from reporting themselves as agreement.
 */
export interface BoxCompositionBlockProps {
  composition: BoxComposition;
}

const BoxCompositionBlock: React.FC<BoxCompositionBlockProps> = ({ composition }) => {
  const t = useT();
  const { units, tags, studios, staff, scoreRange, yearRange, untagged } = composition;

  const row = (labelKey: TranslationKey, values: CompositionValue[]) =>
    values.length === 0 ? null : (
      <div className={styles.row}>
        <span className={styles.label}>{t(labelKey)}</span>
        <span className={styles.values}>
          {values.map(v => (
            <span key={v.value} className={styles.chip}>
              {v.value}
              <span className={styles.share}>{v.count}/{units}</span>
            </span>
          ))}
        </span>
      </div>
    );

  const nothing = tags.length === 0 && studios.length === 0 && staff.length === 0;

  /**
   * ⚠️ The form-axis reading needs at least TWO units to be a finding rather
   * than an arithmetic certainty. Every tally is floored at two units, so a
   * one-unit box can never produce a shared value whatever it contains —
   * announcing « aucun champ du catalogue ne décrit cet axe » there states a
   * conclusion the data cannot support. Caught on screen: a box trimmed to one
   * member declared itself a form axis.
   */
  const canDiagnose = units >= 2;

  return (
    <section className={styles.block}>
      <h2 className={styles.head}>{t('boxes.madeOf')}</h2>

      {nothing ? (
        // Not an error state and not an empty one: "these titles share nothing a
        // catalog field records" is a real, useful answer about the axis — it is
        // the form-axis reading, and the recos tab is what fills such a box.
        <p className={styles.note}>{t(canDiagnose ? 'boxes.madeOfNothing' : 'boxes.madeOfTooSmall')}</p>
      ) : (
        <>
          {row('boxes.madeOfTags', tags)}
          {row('boxes.madeOfStudios', studios)}
          {row('boxes.madeOfStaff', staff)}
        </>
      )}

      <div className={styles.ranges}>
        {scoreRange && (
          <span>
            {t('boxes.madeOfScore')} <b>{scoreRange.min === scoreRange.max
              ? scoreRange.min
              : `${scoreRange.min}–${scoreRange.max}`}</b>
          </span>
        )}
        {yearRange && (
          <span>
            {t('boxes.madeOfYears')} <b>{yearRange.min === yearRange.max
              ? yearRange.min
              : `${yearRange.min}–${yearRange.max}`}</b>
          </span>
        )}
        {/* Coverage, stated rather than logged: a `4/8` means something quite
            different when half the box carries no AniList tag at all. Same
            posture as `GraphCoverage` and `/activity`'s `available: false`. */}
        {untagged > 0 && (
          <span className={styles.coverage}>
            {untagged === 1
              ? t('boxes.madeOfUntaggedOne', { count: 1, units })
              : t('boxes.madeOfUntagged', { count: untagged, units })}
          </span>
        )}
      </div>
    </section>
  );
};

export default BoxCompositionBlock;
