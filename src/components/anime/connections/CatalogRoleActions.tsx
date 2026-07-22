import React from 'react';
import styles from './ProviderActions.module.css';
import { Button } from '@/components/shared';
import type { HistoricalCrawlStats } from '@/lib/providers/mal/sync';
import { useT } from '@/lib/i18n';

/**
 * Catalog-role actions — "what is my catalog?" — one block per provider.
 *
 * Separate components rather than one generic loop, on purpose: MAL's seasonal
 * crawl, SIMKL's delta and AniList's GraphQL batch are genuinely different
 * operations. Only the card *around* them is uniform.
 */

interface MalCatalogActionsProps {
  connected: boolean;
  isBigSyncing: boolean;
  isHistoricalCrawling: boolean;
  historicalStats: HistoricalCrawlStats | null;
  error: string;
  busy: boolean;
  onBigSync: () => void;
  onHistoricalCrawl: () => void;
}

export const MalCatalogActions: React.FC<MalCatalogActionsProps> = ({
  connected, isBigSyncing, isHistoricalCrawling, historicalStats, error, busy,
  onBigSync, onHistoricalCrawl,
}) => {
  const t = useT();
  const crawlDone = historicalStats !== null && historicalStats.remaining === 0;

  return (
    <>
      <div className={styles.buttonGroup}>
        <Button onClick={onBigSync} disabled={!connected || busy} variant="primary-negative">
          {isBigSyncing ? t('dataSync.bigSyncing') : t('dataSync.bigSync')}
        </Button>
        <Button
          onClick={onHistoricalCrawl}
          disabled={!connected || busy || crawlDone}
          variant="secondary"
        >
          {isHistoricalCrawling ? t('dataSync.crawling') : crawlDone ? t('dataSync.historyComplete') : t('dataSync.crawlHistory')}
        </Button>
      </div>
      {historicalStats !== null && (
        <div className={styles.stats}>
          {crawlDone
            ? t('dataSync.allSeasonsSynced', { total: historicalStats.total })
            : `${t('dataSync.seasonsSynced', { synced: historicalStats.synced, total: historicalStats.total })}${historicalStats.oldestSyncedYear ? t('dataSync.backTo', { year: historicalStats.oldestSyncedYear }) : ''}`}
        </div>
      )}
      {error && <div className={styles.error}>{error}</div>}
    </>
  );
};

interface AnilistCatalogActionsProps {
  isMetaSyncing: boolean;
  metaSyncMessage: string;
  metaStats: { totalAnime: number; taggedCount: number } | null;
  isCatalogCrawling: boolean;
  catalogCrawlMessage: string;
  catalogStats: { totalCanonicalIds: number; anilistOnlyIds: number } | null;
  busy: boolean;
  onMetaSync: () => void;
  onCatalogCrawl: () => void;
}

/**
 * Neither of these needs an account, a key, or a connection — which is exactly
 * why they now sit in the *catalog* group instead of under an "AniList account"
 * heading. They are the keyless install's whole catalog pipeline.
 */
export const AnilistCatalogActions: React.FC<AnilistCatalogActionsProps> = ({
  isMetaSyncing, metaSyncMessage, metaStats,
  isCatalogCrawling, catalogCrawlMessage, catalogStats,
  busy, onMetaSync, onCatalogCrawl,
}) => {
  const t = useT();
  return (
    <>
      <div className={styles.buttonGroup}>
        <Button onClick={onMetaSync} disabled={busy} variant="secondary">
          {isMetaSyncing ? t('dataSync.starting') : t('dataSync.syncAnilist')}
        </Button>
        <Button onClick={onCatalogCrawl} disabled={busy} variant="secondary">
          {isCatalogCrawling ? t('dataSync.starting') : t('dataSync.crawlAnilistCatalog')}
        </Button>
      </div>
      {metaStats !== null && (
        <div className={styles.stats}>
          {t('dataSync.animeEnriched', { tagged: metaStats.taggedCount, total: metaStats.totalAnime })}
        </div>
      )}
      {metaSyncMessage && <div className={styles.stats}>{metaSyncMessage}</div>}
      {catalogStats !== null && (
        <div className={styles.stats}>
          {t('dataSync.anilistCatalogAnchored', { total: catalogStats.totalCanonicalIds, anilistOnly: catalogStats.anilistOnlyIds })}
        </div>
      )}
      {catalogCrawlMessage && <div className={styles.stats}>{catalogCrawlMessage}</div>}
    </>
  );
};
