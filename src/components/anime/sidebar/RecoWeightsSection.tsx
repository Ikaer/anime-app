import React, { useEffect, useState } from 'react';
import { SourceWeights } from '@/models/anime';
import { SOURCE_META, DEFAULT_WEIGHTS } from '@/lib/recoWeights';
import { Button } from '@/components/shared';
import styles from './RecoWeightsSection.module.css';

/**
 * Sliders to tune the per-source weights of the recommendation score
 * (`score = Σ weight · sourceValue`). Values persist in the URL, so a tuned
 * feed is shareable / bookmarkable. Reset restores DEFAULT_WEIGHTS.
 *
 * Slider position is tracked in local `draft` state and only committed to the
 * URL (one `router.push` + one feed refetch) on release — dragging a slider
 * would otherwise fire ~20 pushes and pollute browser history.
 */
interface RecoWeightsSectionProps {
  weights: SourceWeights;
  onWeightsChange: (w: SourceWeights) => void;
}

const RecoWeightsSection: React.FC<RecoWeightsSectionProps> = ({ weights, onWeightsChange }) => {
  const [draft, setDraft] = useState<SourceWeights>(weights);

  // Resync when the committed weights change externally (reset, URL nav).
  useEffect(() => { setDraft(weights); }, [weights]);

  const isDefault = SOURCE_META.every(m => draft[m.source] === DEFAULT_WEIGHTS[m.source]);
  const commit = () => onWeightsChange(draft);

  return (
    <div className={styles.weightsSection}>
      {SOURCE_META.map(({ source, label, hint, min, max, step }) => (
        <div key={source} className={styles.weightRow}>
          <div className={styles.weightHead}>
            <span className={styles.weightLabel}>{label}</span>
            <span className={styles.weightValue}>{draft[source].toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={draft[source]}
            onChange={(e) => setDraft(prev => ({ ...prev, [source]: parseFloat(e.target.value) }))}
            onPointerUp={commit}
            onKeyUp={commit}
            className={styles.slider}
            title={hint}
          />
          <span className={styles.weightHint}>{hint}</span>
        </div>
      ))}

      <Button
        variant="secondary"
        size="xs"
        disabled={isDefault}
        onClick={() => onWeightsChange({ ...DEFAULT_WEIGHTS })}
      >
        Réinitialiser les poids
      </Button>
    </div>
  );
};

export default RecoWeightsSection;
