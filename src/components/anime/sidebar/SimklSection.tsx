import React from 'react';
import styles from './SimklSection.module.css';
import { Button } from '@/components/shared';

interface SimklSectionProps {
  isConnected: boolean;
  userName?: string;
  isAuthLoading: boolean;
  authError: string;
  isSyncing: boolean;
  syncMessage: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
}

const SimklSection: React.FC<SimklSectionProps> = ({
  isConnected, userName, isAuthLoading, authError, isSyncing, syncMessage,
  onConnect, onDisconnect, onSync,
}) => {
  return (
    <div className={styles.simklSection}>
      {isAuthLoading ? (
        <Button variant="secondary" disabled>Loading...</Button>
      ) : isConnected ? (
        <div className={styles.connectedAccount}>
          <span>Connected as <strong>{userName || 'SIMKL user'}</strong></span>
          <div className={styles.buttonGroup}>
            <Button onClick={onSync} disabled={isSyncing}>
              {isSyncing ? 'Syncing...' : 'Sync SIMKL'}
            </Button>
            <Button variant="primary-negative" onClick={onDisconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={onConnect}>Connect to SIMKL</Button>
      )}
      {syncMessage && <div className={styles.status}>{syncMessage}</div>}
      {authError && <div className={styles.error}>{authError}</div>}
    </div>
  );
};

export default SimklSection;
