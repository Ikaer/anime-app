import React from 'react';
import styles from './AnilistAuthSection.module.css';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';
import type { AniListPushStats } from '@/lib/anilistPush';

interface AnilistAuthSectionProps {
  isConnected: boolean;
  userName?: string;
  /** False when no AniList client id is configured — connecting can't work yet. */
  isConfigured: boolean;
  isAuthLoading: boolean;
  authError: string;
  onConnect: () => void;
  onDisconnect: () => void;
  /** Drift between the local list and AniList; null until the stats load. */
  pushStats: AniListPushStats | null;
  onPush: () => void;
}

const AnilistAuthSection: React.FC<AnilistAuthSectionProps> = ({
  isConnected, userName, isConfigured, isAuthLoading, authError,
  onConnect, onDisconnect, pushStats, onPush,
}) => {
  const t = useT();
  return (
    <div className={styles.anilistAuthSection}>
      {isAuthLoading ? (
        <Button variant="secondary" disabled>{t('common.loading')}</Button>
      ) : isConnected ? (
        <div className={styles.connectedAccount}>
          <div className={styles.identity}>
            <span className={styles.providerIcon} aria-hidden="true">AL</span>
            <span>{t('account.connectedAs')} <strong>{userName || t('account.anilistUser')}</strong></span>
          </div>
          <Button variant="primary-negative" onClick={onDisconnect}>
            {t('account.disconnect')}
          </Button>

          {/* The one-shot backfill. Only meaningful once connected, and hidden
              entirely when the two lists already agree — after the first run
              the per-edit writer keeps them in step, so this is normally idle. */}
          {pushStats?.connected && (
            <div className={styles.pushBlock}>
              {pushStats.pushRunning ? (
                <>
                  <div className={styles.pushSummary}>
                    {t('anilistPush.running', {
                      index: String(pushStats.progress?.index ?? 0),
                      total: String(pushStats.progress?.total ?? 0),
                    })}
                  </div>
                  <Button variant="secondary" disabled>{t('anilistPush.button')}</Button>
                </>
              ) : pushStats.differing > 0 ? (
                <>
                  <div className={styles.pushSummary}>
                    {t('anilistPush.summary', {
                      differing: String(pushStats.differing),
                      statused: String(pushStats.statused),
                    })}
                  </div>
                  <Button onClick={onPush}>{t('anilistPush.button')}</Button>
                </>
              ) : (
                <div className={styles.inSync}>{t('anilistPush.inSync')}</div>
              )}
              {pushStats.error && <div className={styles.error}>{pushStats.error}</div>}
            </div>
          )}
        </div>
      ) : (
        <>
          <Button onClick={onConnect} disabled={!isConfigured}>{t('account.connectAnilist')}</Button>
          {!isConfigured && <div className={styles.hint}>{t('account.anilistNotConfigured')}</div>}
        </>
      )}
      {authError && <div className={styles.error}>{authError}</div>}
    </div>
  );
};

export default AnilistAuthSection;
