import React from 'react';
import { SourceWeights } from '@/models/anime';
import { RECO_WEIGHT_PRESETS, resolveWeights } from '@/lib/recoWeights';
import { Button } from '@/components/shared';
import { useT, type TranslationKey } from '@/lib/i18n';
import styles from './RecoWeightPresetsSection.module.css';

/**
 * One-click starting points for the weights sliders (`RecoWeightsSection`) —
 * not a replacement for them. Mirrors `ViewsSection`'s layout/behavior for the
 * main list: applying a preset replaces the full weight map and commits once.
 */
interface RecoWeightPresetsSectionProps {
  onApply: (weights: SourceWeights) => void;
}

const RecoWeightPresetsSection: React.FC<RecoWeightPresetsSectionProps> = ({ onApply }) => {
  const t = useT();
  return (
  <div className={styles.viewsSection}>
    {RECO_WEIGHT_PRESETS.map(preset => (
      <Button
        key={preset.key}
        variant="secondary"
        size="xs"
        className={styles.viewButton}
        onClick={() => onApply(resolveWeights(preset.weights))}
        title={t(`reco.preset.${preset.key}.hint` as TranslationKey)}
      >
        {t(`reco.preset.${preset.key}.label` as TranslationKey)}
      </Button>
    ))}
  </div>
  );
};

export default RecoWeightPresetsSection;
