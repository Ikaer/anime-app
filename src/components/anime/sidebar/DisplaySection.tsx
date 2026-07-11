import React from 'react';
import styles from './DisplaySection.module.css';
import { ImageSize } from '@/models/anime';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

interface DisplaySectionProps {
  imageSize: ImageSize;
  onImageSizeChange: (size: ImageSize) => void;
  cardsPerRow: number | null;
  onCardsPerRowChange: (value: number | null) => void;
}

const DisplaySection: React.FC<DisplaySectionProps> = ({
  imageSize,
  onImageSizeChange,
  cardsPerRow,
  onCardsPerRowChange,
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
    <div className={styles.displaySection}>
      <label className={styles.label}>{t('display.imageSize')}</label>
      <div className={styles.sizeButtons}>
        <Button
          variant="secondary"
          size="xs"
          className={`${styles.sizeButton} ${imageSize === 0 ? styles.activeSizeButton : ''}`}
          onClick={() => onImageSizeChange(0)}
        >
          {t('display.original')}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          className={`${styles.sizeButton} ${imageSize === 1 ? styles.activeSizeButton : ''}`}
          onClick={() => onImageSizeChange(1)}
        >
          x1
        </Button>
        <Button
          variant="secondary"
          size="xs"
          className={`${styles.sizeButton} ${imageSize === 2 ? styles.activeSizeButton : ''}`}
          onClick={() => onImageSizeChange(2)}
        >
          x2
        </Button>
        <Button
          variant="secondary"
          size="xs"
          className={`${styles.sizeButton} ${imageSize === 3 ? styles.activeSizeButton : ''}`}
          onClick={() => onImageSizeChange(3)}
        >
          x3
        </Button>
      </div>

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
