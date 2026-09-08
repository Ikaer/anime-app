import React from 'react';
import Image from 'next/image';
import AnimePicker from '../AnimePicker';
import { useT } from '@/lib/i18n';
import styles from './MixAnchorsSection.module.css';

/**
 * The "/mix" anchor picker: a search box that adds anime to the mix, plus the
 * picked set as removable chips. This IS the page's primary control — every
 * add/remove re-ranks the feed — so it sits at the top of the sidebar, above
 * the filters.
 *
 * ⚠️ **The search field itself is the shared [AnimePicker](../AnimePicker.tsx)**,
 * not a copy. Three surfaces now need "pick a title" (this, the « boîtes »
 * landing cards, the group blade), and the panel's geometry rules — fixed
 * positioning, capture-phase scroll re-measure, the 460px minimum that stops six
 * KonoSuba seasons truncating to the same string — are exactly the kind of thing
 * that rots when it exists in three copies. What stays here is the part that is
 * genuinely about a MIX: the anchor chips and the cap.
 */
export interface MixAnchor {
  id: string;
  title: string;
  poster?: string;
}

interface MixAnchorsSectionProps {
  /** Resolved anchors (title + poster come from the API, so a bookmarked mix renders). */
  anchors: MixAnchor[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** Cap on the anchor set; the input goes read-only once reached. */
  max: number;
}

const MixAnchorsSection: React.FC<MixAnchorsSectionProps> = ({ anchors, onAdd, onRemove, max }) => {
  const t = useT();
  const full = anchors.length >= max;

  return (
    <div className={styles.section}>
      <AnimePicker
        picked={new Set(anchors.map(a => a.id))}
        onPick={hit => onAdd(hit.id)}
        placeholder={t('mix.searchPlaceholder')}
        disabled={full}
        disabledPlaceholder={t('mix.anchorsFull', { max })}
      />

      <div className={styles.chips}>
        {anchors.length === 0 ? (
          <p className={styles.empty}>{t('mix.emptyAnchors')}</p>
        ) : (
          anchors.map(a => (
            <span key={a.id} className={styles.chip}>
              {a.poster && <Image src={a.poster} alt="" width={22} height={31} className={styles.chipPoster} unoptimized />}
              <span className={styles.chipTitle} title={a.title}>{a.title}</span>
              <button
                className={styles.chipRemove}
                onClick={() => onRemove(a.id)}
                aria-label={t('mix.removeAnchor', { title: a.title })}
                title={t('mix.removeAnchor', { title: a.title })}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      {anchors.length > 0 && (
        <p className={styles.note}>{t('mix.anchorCount', { count: anchors.length, max })}</p>
      )}
    </div>
  );
};

export default MixAnchorsSection;
