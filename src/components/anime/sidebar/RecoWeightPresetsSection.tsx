import React from 'react';
import { SourceWeights } from '@/models/anime';
import { RECO_WEIGHT_PRESETS, resolveWeights } from '@/lib/recoWeights';
import { Button } from '@/components/shared';
import styles from './RecoWeightPresetsSection.module.css';

/**
 * One-click starting points for the weights sliders (`RecoWeightsSection`) —
 * not a replacement for them. Mirrors `ViewsSection`'s layout/behavior for the
 * main list: applying a preset replaces the full weight map and commits once.
 */
interface RecoWeightPresetsSectionProps {
  onApply: (weights: SourceWeights) => void;
}

const RecoWeightPresetsSection: React.FC<RecoWeightPresetsSectionProps> = ({ onApply }) => (
  <div className={styles.viewsSection}>
    {RECO_WEIGHT_PRESETS.map(preset => (
      <Button
        key={preset.key}
        variant="secondary"
        size="xs"
        className={styles.viewButton}
        onClick={() => onApply(resolveWeights(preset.weights))}
        title={preset.hint}
      >
        {preset.label}
      </Button>
    ))}
  </div>
);

export default RecoWeightPresetsSection;
