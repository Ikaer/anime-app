import React from 'react';
import Image from 'next/image';
import styles from './SimklSection.module.css';
import { Button } from '@/components/shared';

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
  return (
    <div className={styles.simklSection}>
      {isAuthLoading ? (
        <Button variant="secondary" disabled>Loading...</Button>
      ) : isConnected ? (
        <div className={styles.connectedAccount}>
          <div className={styles.identity}>
            <Image src="/simkl.png" alt="SIMKL" width={24} height={24} className={styles.providerIcon} />
            <span>Connected as <strong>{userName || 'SIMKL user'}</strong></span>
          </div>
          <Button variant="primary-negative" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      ) : (
        <Button onClick={onConnect}>Connect to SIMKL</Button>
      )}
      {authError && <div className={styles.error}>{authError}</div>}
    </div>
  );
};

export default SimklSection;
