import React from 'react';
import styles from './AccountSection.module.css';
import { MALAuthState } from '@/models/anime';
import { Button } from '@/components/shared';

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
  return (
    <div className={styles.accountsSection}>
      {isAuthLoading ? (
        <Button variant="secondary" disabled>Loading...</Button>
      ) : authState.isAuthenticated ? (
        <div className={styles.connectedAccount}>
          <span>Connected as <strong>{authState.user?.name}</strong></span>
          <Button variant="primary-negative" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Button onClick={onConnect}>
          Connect to MyAnimeList
        </Button>
      )}
      {authError && <div className={styles.error}>{authError}</div>}
    </div>
  );
};

export default AccountSection;
