import React from 'react';
import styles from './DataSyncSection.module.css';
import { MALAuthState } from '@/models/anime';
import { Button } from '@/components/shared';
import type { HistoricalCrawlStats } from '@/lib/malSync';
import type { AniListPersonalImportResult } from '@/lib/anilistPersonalSync';
import { useT } from '@/lib/i18n';

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
  isAnilistCatalogCrawling: boolean;
  anilistCatalogCrawlMessage: string;
  anilistCatalogStats: { totalCanonicalIds: number; anilistOnlyIds: number } | null;
  onAnilistCatalogCrawl: () => void;
  isAnilistImporting: boolean;
  anilistImportResult: AniListPersonalImportResult | null;
  anilistImportUsername?: string;
  anilistImportStoredCount: number | null;
  onAnilistPersonalImport: (username: string) => void;
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
  isAnilistCatalogCrawling,
  anilistCatalogCrawlMessage,
  anilistCatalogStats,
  onAnilistCatalogCrawl,
  isAnilistImporting,
  anilistImportResult,
  anilistImportUsername,
  anilistImportStoredCount,
  onAnilistPersonalImport,
  simklConnected,
  isSimklSyncing,
  simklSyncMessage,
  onSimklSync,
}) => {
  const t = useT();
  const [anilistUsername, setAnilistUsername] = React.useState('');
  // Pre-fill the field once the saved username loads, without clobbering typing.
  React.useEffect(() => {
    if (anilistImportUsername) setAnilistUsername(prev => prev || anilistImportUsername);
  }, [anilistImportUsername]);
  const anyBusy = isSyncing || isBigSyncing || isHistoricalCrawling || isAnilistMetaSyncing || isAnilistCatalogCrawling || isAnilistImporting || isSimklSyncing;
  const crawlDone = historicalStats !== null && historicalStats.remaining === 0;

  const importMessage = (() => {
    if (!anilistImportResult) return null;
    if (anilistImportResult.ok) {
      return t('dataSync.anilistImportDone', {
        imported: anilistImportResult.imported,
        skipped: anilistImportResult.skippedNoMal,
      });
    }
    switch (anilistImportResult.errorKind) {
      case 'private': return t('dataSync.anilistImportPrivate');
      case 'not_found': return t('dataSync.anilistImportNotFound');
      case 'empty': return t('dataSync.anilistImportEmpty');
      default: return t('dataSync.anilistImportError');
    }
  })();

  return (
    <div className={styles.dataSyncSection}>
      <div className={styles.buttonGroup}>
        <Button onClick={onSync} disabled={!authState.isAuthenticated || anyBusy}>
          {isSyncing ? t('dataSync.syncing') : t('dataSync.syncMal')}
        </Button>
        <Button
          onClick={onBigSync}
          disabled={!authState.isAuthenticated || anyBusy}
          variant="primary-negative"
        >
          {isBigSyncing ? t('dataSync.bigSyncing') : t('dataSync.bigSync')}
        </Button>
      </div>
      <div className={styles.buttonGroup}>
        <Button
          onClick={onHistoricalCrawl}
          disabled={!authState.isAuthenticated || anyBusy || crawlDone}
          variant="secondary"
        >
          {isHistoricalCrawling ? t('dataSync.crawling') : crawlDone ? t('dataSync.historyComplete') : t('dataSync.crawlHistory')}
        </Button>
      </div>
      {historicalStats !== null && (
        <div className={styles.crawlStats}>
          {crawlDone
            ? t('dataSync.allSeasonsSynced', { total: historicalStats.total })
            : `${t('dataSync.seasonsSynced', { synced: historicalStats.synced, total: historicalStats.total })}${historicalStats.oldestSyncedYear ? t('dataSync.backTo', { year: historicalStats.oldestSyncedYear }) : ''}`}
        </div>
      )}
      {syncError && <div className={styles.error}>{syncError}</div>}
      <div className={styles.buttonGroup}>
        <Button onClick={onSimklSync} disabled={!simklConnected || anyBusy}>
          {isSimklSyncing ? t('dataSync.syncing') : t('dataSync.syncSimkl')}
        </Button>
      </div>
      {simklSyncMessage && <div className={styles.crawlStats}>{simklSyncMessage}</div>}
      <div className={styles.buttonGroup}>
        <Button onClick={onAnilistMetaSync} disabled={anyBusy} variant="secondary">
          {isAnilistMetaSyncing ? t('dataSync.starting') : t('dataSync.syncAnilist')}
        </Button>
      </div>
      {anilistMetaStats !== null && (
        <div className={styles.crawlStats}>
          {t('dataSync.animeEnriched', { tagged: anilistMetaStats.taggedCount, total: anilistMetaStats.totalAnime })}
        </div>
      )}
      {anilistMetaSyncMessage && <div className={styles.crawlStats}>{anilistMetaSyncMessage}</div>}
      <div className={styles.buttonGroup}>
        <Button onClick={onAnilistCatalogCrawl} disabled={anyBusy} variant="secondary">
          {isAnilistCatalogCrawling ? t('dataSync.starting') : t('dataSync.crawlAnilistCatalog')}
        </Button>
      </div>
      {anilistCatalogStats !== null && (
        <div className={styles.crawlStats}>
          {t('dataSync.anilistCatalogAnchored', { total: anilistCatalogStats.totalCanonicalIds, anilistOnly: anilistCatalogStats.anilistOnlyIds })}
        </div>
      )}
      {anilistCatalogCrawlMessage && <div className={styles.crawlStats}>{anilistCatalogCrawlMessage}</div>}
      <div className={styles.importRow}>
        <input
          type="text"
          className={styles.usernameInput}
          placeholder={t('dataSync.anilistUsernamePlaceholder')}
          value={anilistUsername}
          onChange={e => setAnilistUsername(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && anilistUsername.trim() && !anyBusy) onAnilistPersonalImport(anilistUsername);
          }}
          disabled={anyBusy}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <Button
          onClick={() => onAnilistPersonalImport(anilistUsername)}
          disabled={anyBusy || !anilistUsername.trim()}
          variant="secondary"
        >
          {isAnilistImporting ? t('dataSync.anilistImporting') : t('dataSync.anilistImport')}
        </Button>
      </div>
      {anilistImportStoredCount !== null && anilistImportStoredCount > 0 && (
        <div className={styles.crawlStats}>
          {t('dataSync.anilistImportStored', { count: anilistImportStoredCount, user: anilistImportUsername ?? '' })}
        </div>
      )}
      {importMessage && <div className={styles.crawlStats}>{importMessage}</div>}
    </div>
  );
};

export default DataSyncSection;
