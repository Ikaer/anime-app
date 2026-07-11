import React from 'react';
import Image from 'next/image';
import styles from './AccountSection.module.css';
import { MALAuthState } from '@/models/anime';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

interface AccountSectionProps {
  authState: MALAuthState;
  isAuthLoading: boolean;
  authError: string;
  onConnect: () => void;
  onDisconnect: () => void;
}

const AccountSection: React.FC<AccountSectionProps> = ({
  authState,
  isAuthLoading,
  authError,
  onConnect,
  onDisconnect,
}) => {
  const t = useT();
  return (
    <div className={styles.accountsSection}>
      {isAuthLoading ? (
        <Button variant="secondary" disabled>{t('common.loading')}</Button>
      ) : authState.isAuthenticated ? (
        <div className={styles.connectedAccount}>
          <div className={styles.identity}>
            <Image src="/mal.png" alt="MAL" width={24} height={24} className={styles.providerIcon} />
            <span>{t('account.connectedAs')} <strong>{authState.user?.name}</strong></span>
          </div>
          <Button variant="primary-negative" onClick={onDisconnect}>
            {t('account.disconnect')}
          </Button>
        </div>
      ) : (
        <Button onClick={onConnect}>
          {t('account.connectMal')}
        </Button>
      )}
      {authError && <div className={styles.error}>{authError}</div>}
    </div>
  );
};

export default AccountSection;
