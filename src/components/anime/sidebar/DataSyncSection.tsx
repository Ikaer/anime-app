import React from 'react';
import styles from './DataSyncSection.module.css';
import { MALAuthState } from '@/models/anime';
import { Button } from '@/components/shared';
import type { HistoricalCrawlStats } from '@/lib/anime';

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
  isAnilistTagsSyncing: boolean;
  anilistTagsSyncMessage: string;
  anilistTagStats: { totalAnime: number; taggedCount: number } | null;
  onAnilistTagsSync: () => void;
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
  isAnilistTagsSyncing,
  anilistTagsSyncMessage,
  anilistTagStats,
  onAnilistTagsSync,
}) => {
  const anyBusy = isSyncing || isBigSyncing || isHistoricalCrawling || isAnilistTagsSyncing;
  const crawlDone = historicalStats !== null && historicalStats.remaining === 0;

  return (
    <div className={styles.dataSyncSection}>
      <div className={styles.buttonGroup}>
        <Button onClick={onSync} disabled={!authState.isAuthenticated || anyBusy}>
          {isSyncing ? 'Syncing...' : 'Sync Data'}
        </Button>
        <Button
          onClick={onBigSync}
          disabled={!authState.isAuthenticated || anyBusy}
          variant="primary-negative"
        >
          {isBigSyncing ? 'Big Syncing...' : 'Big Sync'}
        </Button>
      </div>
      <div className={styles.buttonGroup}>
        <Button
          onClick={onHistoricalCrawl}
          disabled={!authState.isAuthenticated || anyBusy || crawlDone}
          variant="secondary"
        >
          {isHistoricalCrawling ? 'Crawling...' : crawlDone ? 'History Complete' : 'Crawl History'}
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
        <Button onClick={onAnilistTagsSync} disabled={anyBusy} variant="secondary">
          {isAnilistTagsSyncing ? 'Starting...' : 'Sync AniList Tags + Staff'}
        </Button>
      </div>
      {anilistTagStats !== null && (
        <div className={styles.crawlStats}>
          {anilistTagStats.taggedCount} / {anilistTagStats.totalAnime} anime enrichis
        </div>
      )}
      {anilistTagsSyncMessage && <div className={styles.crawlStats}>{anilistTagsSyncMessage}</div>}
    </div>
  );
};

export default DataSyncSection;
