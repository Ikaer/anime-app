import Head from 'next/head';
import { AccountSection, SimklSection, AnilistAuthSection, DataSyncSection, ConnectionLogPanel } from '@/components/anime';
import { useConnections } from '@/hooks';
import { useT } from '@/lib/i18n';

export default function ConnectionsPage() {
  const t = useT();
  const { mal, simkl, anilist } = useConnections();

  return (
    <>
      <Head>
        <title>{t('conn.pageTitle')}</title>
        <meta name="description" content={t('conn.metaDescription')} />
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <div className="connections-page">
        <div className="connections-col">
          <section className="connections-section">
            <h2>MyAnimeList</h2>
            <AccountSection
              authState={mal.authState}
              isAuthLoading={mal.isAuthLoading}
              authError={mal.authError}
              onConnect={mal.onConnect}
              onDisconnect={mal.onDisconnect}
            />
          </section>
          <section className="connections-section">
            <h2>SIMKL</h2>
            <SimklSection
              isConnected={simkl.isConnected}
              userName={simkl.userName}
              isAuthLoading={simkl.isAuthLoading}
              authError={simkl.authError}
              onConnect={simkl.onConnect}
              onDisconnect={simkl.onDisconnect}
            />
          </section>
          <section className="connections-section">
            <h2>AniList</h2>
            <AnilistAuthSection
              isConnected={anilist.isConnected}
              userName={anilist.userName}
              isConfigured={anilist.isConfigured}
              isAuthLoading={anilist.isAuthLoading}
              authError={anilist.authError}
              onConnect={anilist.onConnect}
              onDisconnect={anilist.onDisconnect}
              pushStats={anilist.pushStats}
              onPush={anilist.onPush}
            />
          </section>
          <section className="connections-section">
            <h2>{t('conn.sync')}</h2>
            <DataSyncSection
              authState={mal.authState}
              isSyncing={mal.isSyncing}
              isBigSyncing={mal.isBigSyncing}
              isHistoricalCrawling={mal.isHistoricalCrawling}
              syncError={mal.syncError}
              historicalStats={mal.historicalStats}
              onSync={mal.onSync}
              onBigSync={mal.onBigSync}
              onHistoricalCrawl={mal.onHistoricalCrawl}
              isAnilistMetaSyncing={anilist.isSyncing}
              anilistMetaSyncMessage={anilist.syncMessage}
              anilistMetaStats={anilist.tagStats}
              onAnilistMetaSync={anilist.onSync}
              isAnilistCatalogCrawling={anilist.isCatalogCrawling}
              anilistCatalogCrawlMessage={anilist.catalogCrawlMessage}
              anilistCatalogStats={anilist.catalogStats}
              onAnilistCatalogCrawl={anilist.onCatalogCrawl}
              anilistConnected={anilist.isConnected}
              isAnilistImporting={anilist.isImporting}
              anilistImportResult={anilist.importResult}
              anilistImportStoredCount={anilist.importStoredCount}
              onAnilistPersonalImport={anilist.onPersonalImport}
              simklConnected={simkl.isConnected}
              isSimklSyncing={simkl.isSyncing}
              simklSyncMessage={simkl.syncMessage}
              onSimklSync={simkl.onSync}
            />
          </section>
        </div>
        <div className="connections-log">
          <ConnectionLogPanel />
        </div>
      </div>
      <style jsx>{`
        .connections-page { display: grid; grid-template-columns: minmax(340px, 440px) 1fr; gap: 1.5rem; align-items: stretch; height: calc(100vh - 144px); min-height: 500px; }
        .connections-col { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; overflow-y: auto; }
        .connections-log { display: flex; min-width: 0; min-height: 0; }
        .connections-section { background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; }
        .connections-section h2 { margin: 0 0 0.75rem; font-size: 1.1rem; color: var(--text-primary); }
        @media (max-width: 800px) {
          .connections-page { grid-template-columns: 1fr; height: auto; min-height: 0; }
          .connections-col { overflow-y: visible; }
          .connections-log { min-height: 500px; }
        }
      `}</style>
    </>
  );
}
