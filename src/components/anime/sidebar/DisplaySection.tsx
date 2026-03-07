import React from 'react';
import styles from './DisplaySection.module.css';
import { ImageSize } from '@/models/anime';
import { Button } from '@/components/shared';

interface DisplaySectionProps {
  imageSize: ImageSize;
  onImageSizeChange: (size: ImageSize) => void;
}

const DisplaySection: React.FC<DisplaySectionProps> = ({
  imageSize,
  onImageSizeChange,
}) => {
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
    </div>
  );
};

export default DisplaySection;
