import React from 'react';
import styles from './DataSyncSection.module.css';
import { MALAuthState } from '@/models/anime';
import { Button } from '@/components/shared';

interface DataSyncSectionProps {
  authState: MALAuthState;
  isSyncing: boolean;
  isBigSyncing: boolean;
  syncError: string;
  onSync: () => void;
  onBigSync: () => void;
}

const DataSyncSection: React.FC<DataSyncSectionProps> = ({
  authState,
  isSyncing,
  isBigSyncing,
  syncError,
  onSync,
  onBigSync,
}) => {
  return (
    <div className={styles.dataSyncSection}>
      <div className={styles.buttonGroup}>
        <Button
          onClick={onSync}
          disabled={!authState.isAuthenticated || isSyncing || isBigSyncing}
        >
          {isSyncing ? 'Syncing...' : 'Sync Data'}
        </Button>
        <Button
          onClick={onBigSync}
          disabled={!authState.isAuthenticated || isSyncing || isBigSyncing}
          variant="primary-negative"
        >
          {isBigSyncing ? 'Big Syncing...' : 'Big Sync'}
        </Button>
      </div>
      {syncError && <div className={styles.error}>{syncError}</div>}
    </div>
  );
};

export default DataSyncSection;
