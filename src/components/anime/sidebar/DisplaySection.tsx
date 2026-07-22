import React from 'react';
import styles from './DisplaySection.module.css';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

/**
 * Card-grid display controls — cards per row, and nothing else.
 *
 * It used to carry an "image size" button row too. That only ever sized the
 * table's thumbnails: `AnimeCardView` accepted the prop and never read it, its
 * grid being `minmax(280px, 1fr)` or an explicit `cardsPerRow`. So the buttons
 * went dead the moment the table was removed, and cards-per-row already answers
 * "how big are the cards". `/tier`'s thumbnail-size buttons are a separate,
 * genuinely wired control — they are not this.
 */
interface DisplaySectionProps {
  cardsPerRow: number | null;
  onCardsPerRowChange: (value: number | null) => void;
  /**
   * `stack` (default) is the sidebar's vertical group — still how
   * `/recommendations` and `/tier` render it. `inline` is the same markup laid
   * out as one row for `AnimeListHeader`, a CSS switch only.
   */
  variant?: 'stack' | 'inline';
}

const DisplaySection: React.FC<DisplaySectionProps> = ({
  cardsPerRow,
  onCardsPerRowChange,
  variant = 'stack',
}) => {
  const t = useT();
  const handleCardsPerRowInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    if (raw === '') {
      onCardsPerRowChange(null);
      return;
    }
    const n = parseInt(raw, 10);
    onCardsPerRowChange(Number.isFinite(n) && n > 0 ? n : null);
  };

  return (
    <div className={`${styles.displaySection} ${variant === 'inline' ? styles.inline : ''}`}>
      <label className={styles.label}>{t('display.cardsPerRow')}</label>
      <div className={styles.cardsPerRow}>
        <input
          type="number"
          min={1}
          step={1}
          value={cardsPerRow ?? ''}
          onChange={handleCardsPerRowInput}
          placeholder={t('display.auto')}
          className={styles.cardsPerRowInput}
          aria-label={t('display.cardsPerRow')}
        />
        <Button
          variant="secondary"
          size="xs"
          className={styles.clearButton}
          onClick={() => onCardsPerRowChange(null)}
          disabled={cardsPerRow === null}
        >
          {t('common.clear')}
        </Button>
      </div>
    </div>
  );
};

export default DisplaySection;
