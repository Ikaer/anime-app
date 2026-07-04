import React from 'react';
import styles from './RecommendationsSection.module.css';
import { MALAuthState } from '@/models/anime';
import { Button } from '@/components/shared';

interface RecommendationsSectionProps {
  authState: MALAuthState;
  isRefreshingRecos: boolean;
  recoProgress: string;
  recoLastRefresh: string | null;
  recoError: string;
  nicheMode: boolean;
  threshold: number | null;
  onRefreshRecos: () => void;
  onNicheModeChange: (v: boolean) => void;
  onThresholdChange: (v: number | null) => void;
  onShowLiked: () => void;
  onShowDisliked: () => void;
}

const DEFAULT_THRESHOLD = 8;

const RecommendationsSection: React.FC<RecommendationsSectionProps> = ({
  authState,
  isRefreshingRecos,
  recoProgress,
  recoLastRefresh,
  recoError,
  nicheMode,
  threshold,
  onRefreshRecos,
  onNicheModeChange,
  onThresholdChange,
  onShowLiked,
  onShowDisliked,
}) => {
  return (
    <div className={styles.recommendationsSection}>
      <Button
        onClick={onRefreshRecos}
        disabled={!authState.isAuthenticated || isRefreshingRecos}
        variant="primary"
      >
        {isRefreshingRecos ? 'Rafraîchissement...' : '↻ Rafraîchir les recos'}
      </Button>

      {isRefreshingRecos && recoProgress && (
        <div className={styles.progress}>{recoProgress}</div>
      )}

      <div className={styles.fieldGroup}>
        <label className={styles.label}>Seuil de note des graines:</label>
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
        Mode niche (2-hop, plus lent)
      </label>

      <div className={styles.lastRefresh}>
        {recoLastRefresh
          ? `Dernier refresh : ${new Date(recoLastRefresh).toLocaleString()}`
          : 'Jamais rafraîchi'}
      </div>

      <div className={styles.reviewLinks}>
        <Button onClick={onShowLiked} variant="secondary" size="xs">
          👍 Bonnes pioches
        </Button>
        <Button onClick={onShowDisliked} variant="secondary" size="xs">
          👎 Pas pour moi
        </Button>
      </div>

      {recoError && <div className={styles.error}>{recoError}</div>}
    </div>
  );
};

export default RecommendationsSection;
