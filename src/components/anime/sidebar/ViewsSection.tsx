import React from 'react';
import styles from './ViewsSection.module.css';
import { VIEW_PRESETS } from '@/lib/animeUrlParams';
import { useAnimeUrlState } from '@/hooks';
import { Button } from '@/components/shared';

const ViewsSection: React.FC = () => {
  const { applyPreset } = useAnimeUrlState();

  const handlePresetClick = (getState: () => any) => {
    applyPreset(getState());
  };

  return (
    <div className={styles.viewsSection}>
      {VIEW_PRESETS.map(preset => (
        <Button
          key={preset.key}
          variant="secondary"
          size="xs"
          className={styles.viewButton}
          onClick={() => handlePresetClick(preset.getState)}
          title={preset.description}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
};

export default ViewsSection;
