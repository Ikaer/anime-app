import React from 'react';
import Image from 'next/image';
import styles from './SimklSection.module.css';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

interface SimklSectionProps {
  isConnected: boolean;
  userName?: string;
  isAuthLoading: boolean;
  authError: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

const SimklSection: React.FC<SimklSectionProps> = ({
  isConnected, userName, isAuthLoading, authError,
  onConnect, onDisconnect,
}) => {
  const t = useT();
  return (
    <div className={styles.simklSection}>
      {isAuthLoading ? (
        <Button variant="secondary" disabled>{t('common.loading')}</Button>
      ) : isConnected ? (
        <div className={styles.connectedAccount}>
          <div className={styles.identity}>
            <Image src="/simkl.png" alt="SIMKL" width={24} height={24} className={styles.providerIcon} />
            <span>{t('account.connectedAs')} <strong>{userName || t('account.simklUser')}</strong></span>
          </div>
          <Button variant="primary-negative" onClick={onDisconnect}>
            {t('account.disconnect')}
          </Button>
        </div>
      ) : (
        <Button onClick={onConnect}>{t('account.connectSimkl')}</Button>
      )}
      {authError && <div className={styles.error}>{authError}</div>}
    </div>
  );
};

export default SimklSection;
