import React from 'react';
import { useRouter } from 'next/router';
import styles from './ViewsSection.module.css';
import { VIEW_PRESETS } from '@/lib/animeUrlParams';
import { useAnimeUrlState } from '@/hooks';
import { Button } from '@/components/shared';

const ViewsSection: React.FC = () => {
  const router = useRouter();
  const { applyPreset } = useAnimeUrlState();

  const handlePresetClick = (getState: () => any) => {
    applyPreset(getState());
  };

  return (
    <div className={styles.viewsSection}>
      <Button
        variant="primary"
        size="xs"
        className={styles.viewButton}
        onClick={() => router.push('/recommendations')}
        title="Recommandations personnalisées (titres non vus)"
      >
        ✨ Pour toi
      </Button>
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
