import React, { useEffect, useState } from 'react';
import { SourceWeights } from '@/models/anime';
import { SOURCE_META } from '@/lib/recoWeights';
import { useT, type TranslationKey } from '@/lib/i18n';
import styles from './RecoWeightsSection.module.css';

/**
 * Sliders to tune the per-source weights of the recommendation score
 * (`score = Σ weight · sourceValue`). Values persist in the URL, so a tuned
 * feed is shareable / bookmarkable. One-click starting points live in the
 * separate `RecoWeightPresetsSection` ("Views") — this component just
 * reflects whatever `weights` ends up being, from a preset or manual tuning.
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
  const t = useT();
  const [draft, setDraft] = useState<SourceWeights>(weights);

  // Resync when the committed weights change externally (preset, URL nav).
  useEffect(() => { setDraft(weights); }, [weights]);

  const commit = () => onWeightsChange(draft);

  return (
    <div className={styles.weightsSection}>
      {SOURCE_META.map(({ source, min, max, step }) => {
        const label = t(`reco.source.${source}.label` as TranslationKey);
        const hint = t(`reco.source.${source}.hint` as TranslationKey);
        return (
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
        );
      })}
    </div>
  );
};

export default RecoWeightsSection;
