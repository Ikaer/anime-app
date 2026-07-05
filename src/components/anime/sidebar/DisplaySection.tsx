import React from 'react';
import styles from './DisplaySection.module.css';
import { ImageSize } from '@/models/anime';
import { Button } from '@/components/shared';

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
      <label className={styles.label}>Image Size:</label>
      <div className={styles.sizeButtons}>
        <Button
          variant="secondary"
          size="xs"
          className={`${styles.sizeButton} ${imageSize === 0 ? styles.activeSizeButton : ''}`}
          onClick={() => onImageSizeChange(0)}
        >
          Original
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

      <label className={styles.label}>Cards per row:</label>
      <div className={styles.cardsPerRow}>
        <input
          type="number"
          min={1}
          step={1}
          value={cardsPerRow ?? ''}
          onChange={handleCardsPerRowInput}
          placeholder="Auto"
          className={styles.cardsPerRowInput}
          aria-label="Cards per row"
        />
        <Button
          variant="secondary"
          size="xs"
          className={styles.clearButton}
          onClick={() => onCardsPerRowChange(null)}
          disabled={cardsPerRow === null}
        >
          Clear
        </Button>
      </div>
    </div>
  );
};

export default DisplaySection;
