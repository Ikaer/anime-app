import React from 'react';
import styles from './AnilistAuthSection.module.css';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

interface AnilistAuthSectionProps {
  isConnected: boolean;
  userName?: string;
  /** False when no AniList client id is configured — connecting can't work yet. */
  isConfigured: boolean;
  isAuthLoading: boolean;
  authError: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

const AnilistAuthSection: React.FC<AnilistAuthSectionProps> = ({
  isConnected, userName, isConfigured, isAuthLoading, authError,
  onConnect, onDisconnect,
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
