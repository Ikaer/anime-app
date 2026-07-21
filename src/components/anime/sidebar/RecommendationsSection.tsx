import React, { useEffect, useState } from 'react';
import styles from './RecommendationsSection.module.css';
import { Button } from '@/components/shared';
import { DIVERSITY_MAX, DIVERSITY_STEP } from '@/lib/recoWeights';
import { useT } from '@/lib/i18n';

interface RecommendationsSectionProps {
  isRefreshingRecos: boolean;
  recoProgress: string;
  recoLastRefresh: string | null;
  recoError: string;
  nicheMode: boolean;
  threshold: number | null;
  diversity: number | null;
  onRefreshRecos: () => void;
  onNicheModeChange: (v: boolean) => void;
  onThresholdChange: (v: number | null) => void;
  onDiversityChange: (v: number | null) => void;
  onShowLiked: () => void;
  onShowDisliked: () => void;
}

const DEFAULT_THRESHOLD = 8;

const RecommendationsSection: React.FC<RecommendationsSectionProps> = ({
  isRefreshingRecos,
  recoProgress,
  recoLastRefresh,
  recoError,
  nicheMode,
  threshold,
  diversity,
  onRefreshRecos,
  onNicheModeChange,
  onThresholdChange,
  onDiversityChange,
  onShowLiked,
  onShowDisliked,
}) => {
  const t = useT();
  // Slider position tracked locally; committed to the URL only on release so a
  // drag fires one router.push + one refetch, not one per tick (mirrors
  // RecoWeightsSection). null diversity renders as 0 ("Ciblé").
  const [divDraft, setDivDraft] = useState(diversity ?? 0);
  useEffect(() => { setDivDraft(diversity ?? 0); }, [diversity]);
  const commitDiversity = () => onDiversityChange(divDraft > 0 ? divDraft : null);

  return (
    <div className={styles.recommendationsSection}>
      <Button
        onClick={onRefreshRecos}
        disabled={isRefreshingRecos}
        variant="primary"
      >
        {isRefreshingRecos ? t('reco.refreshing') : t('reco.refresh')}
      </Button>

      {isRefreshingRecos && recoProgress && (
        <div className={styles.progress}>{recoProgress}</div>
      )}

      <div className={styles.fieldGroup}>
        <label className={styles.label}>{t('reco.seedThreshold')}</label>
        <input
          type="number"
          min="1"
          max="10"
          step="1"
          placeholder={String(DEFAULT_THRESHOLD)}
          value={threshold ?? ''}
          onChange={(e) => onThresholdChange(e.target.value ? parseInt(e.target.value, 10) : null)}
          className={styles.thresholdInput}
        />
      </div>

      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={nicheMode}
          onChange={(e) => onNicheModeChange(e.target.checked)}
        />
        {t('reco.nicheMode')}
      </label>

      <div className={styles.fieldGroup}>
        <div className={styles.sliderHead}>
          <span className={styles.label}>{t('reco.diversity')}</span>
          <span className={styles.sliderValue}>{divDraft.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={DIVERSITY_MAX}
          step={DIVERSITY_STEP}
          value={divDraft}
          onChange={(e) => setDivDraft(parseFloat(e.target.value))}
          onPointerUp={commitDiversity}
          onKeyUp={commitDiversity}
          className={styles.slider}
          title={t('reco.diversityHint')}
        />
        <div className={styles.sliderEnds}>
          <span>{t('reco.targeted')}</span>
          <span>{t('reco.varied')}</span>
        </div>
      </div>

      <div className={styles.lastRefresh}>
        {recoLastRefresh
          ? t('reco.lastRefresh', { date: new Date(recoLastRefresh).toLocaleString() })
          : t('reco.neverRefreshed')}
      </div>

      <div className={styles.reviewLinks}>
        <Button onClick={onShowLiked} variant="secondary" size="xs">
          {t('reco.goodPicks')}
        </Button>
        <Button onClick={onShowDisliked} variant="secondary" size="xs">
          {t('reco.notForMe')}
        </Button>
      </div>

      {recoError && <div className={styles.error}>{recoError}</div>}
    </div>
  );
};

export default RecommendationsSection;
