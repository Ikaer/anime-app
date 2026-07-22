import React from 'react';
import styles from './ViewsSection.module.css';
import { VIEW_PRESETS } from '@/lib/url/animeParams';
import { useAnimeUrlState } from '@/hooks';
import { Button } from '@/components/shared';
import { useT, type TranslationKey } from '@/lib/i18n';

const ViewsSection: React.FC = () => {
  const { applyPreset } = useAnimeUrlState();
  const t = useT();

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
          title={t(`views.${preset.key}.description` as TranslationKey)}
        >
          {t(`views.${preset.key}.label` as TranslationKey)}
        </Button>
      ))}
    </div>
  );
};

export default ViewsSection;
