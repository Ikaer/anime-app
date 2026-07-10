import React from 'react';
import styles from './DataSyncSection.module.css';
import { MALAuthState } from '@/models/anime';
import { Button } from '@/components/shared';
import type { HistoricalCrawlStats } from '@/lib/malSync';

interface DataSyncSectionProps {
  authState: MALAuthState;
  isSyncing: boolean;
  isBigSyncing: boolean;
  isHistoricalCrawling: boolean;
  syncError: string;
  historicalStats: HistoricalCrawlStats | null;
  onSync: () => void;
  onBigSync: () => void;
  onHistoricalCrawl: () => void;
  isAnilistMetaSyncing: boolean;
  anilistMetaSyncMessage: string;
  anilistMetaStats: { totalAnime: number; taggedCount: number } | null;
  onAnilistMetaSync: () => void;
  simklConnected: boolean;
  isSimklSyncing: boolean;
  simklSyncMessage: string;
  onSimklSync: () => void;
}

const DataSyncSection: React.FC<DataSyncSectionProps> = ({
  authState,
  isSyncing,
  isBigSyncing,
  isHistoricalCrawling,
  syncError,
  historicalStats,
  onSync,
  onBigSync,
  onHistoricalCrawl,
  isAnilistMetaSyncing,
  anilistMetaSyncMessage,
  anilistMetaStats,
  onAnilistMetaSync,
  simklConnected,
  isSimklSyncing,
  simklSyncMessage,
  onSimklSync,
}) => {
  const anyBusy = isSyncing || isBigSyncing || isHistoricalCrawling || isAnilistMetaSyncing || isSimklSyncing;
  const crawlDone = historicalStats !== null && historicalStats.remaining === 0;

  return (
    <div className={styles.dataSyncSection}>
      <div className={styles.buttonGroup}>
        <Button onClick={onSync} disabled={!authState.isAuthenticated || anyBusy}>
          {isSyncing ? 'Syncing...' : 'Sync MAL Data'}
        </Button>
        <Button
          onClick={onBigSync}
          disabled={!authState.isAuthenticated || anyBusy}
          variant="primary-negative"
        >
          {isBigSyncing ? 'Big Syncing...' : 'MAL Big Sync'}
        </Button>
      </div>
      <div className={styles.buttonGroup}>
        <Button
          onClick={onHistoricalCrawl}
          disabled={!authState.isAuthenticated || anyBusy || crawlDone}
          variant="secondary"
        >
          {isHistoricalCrawling ? 'Crawling...' : crawlDone ? 'MAL History Complete' : 'Crawl MAL History'}
        </Button>
      </div>
      {historicalStats !== null && (
        <div className={styles.crawlStats}>
          {crawlDone
            ? `All ${historicalStats.total} historical seasons synced`
            : `${historicalStats.synced} / ${historicalStats.total} seasons synced${historicalStats.oldestSyncedYear ? ` (back to ${historicalStats.oldestSyncedYear})` : ''}`}
        </div>
      )}
      {syncError && <div className={styles.error}>{syncError}</div>}
      <div className={styles.buttonGroup}>
        <Button onClick={onSimklSync} disabled={!simklConnected || anyBusy}>
          {isSimklSyncing ? 'Syncing...' : 'Sync SIMKL'}
        </Button>
      </div>
      {simklSyncMessage && <div className={styles.crawlStats}>{simklSyncMessage}</div>}
      <div className={styles.buttonGroup}>
        <Button onClick={onAnilistMetaSync} disabled={anyBusy} variant="secondary">
          {isAnilistMetaSyncing ? 'Starting...' : 'Sync AniList Metadata'}
        </Button>
      </div>
      {anilistMetaStats !== null && (
        <div className={styles.crawlStats}>
          {anilistMetaStats.taggedCount} / {anilistMetaStats.totalAnime} anime enrichis
        </div>
      )}
      {anilistMetaSyncMessage && <div className={styles.crawlStats}>{anilistMetaSyncMessage}</div>}
    </div>
  );
};

export default DataSyncSection;
