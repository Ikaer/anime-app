import Head from 'next/head';
import { AccountSection, SimklSection, DataSyncSection, ConnectionLogPanel } from '@/components/anime';
import { useConnections } from '@/hooks';

export default function ConnectionsPage() {
  const {
    authState, isAuthLoading, authError, onConnect, onDisconnect,
    isSyncing, isBigSyncing, isHistoricalCrawling, syncError, historicalStats,
    onSync, onBigSync, onHistoricalCrawl,
    simklConnected, simklUser, isSimklAuthLoading, simklAuthError,
    isSimklSyncing, simklSyncMessage, onSimklConnect, onSimklDisconnect, onSimklSync,
    isAnilistTagsSyncing, anilistTagsSyncMessage, anilistTagStats, onAnilistTagsSync,
  } = useConnections();

  return (
    <>
      <Head>
        <title>Connections - MyHomeApp</title>
        <meta name="description" content="Manage MyAnimeList/SIMKL connections and sync activity" />
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <div className="connections-page">
        <section className="connections-section">
          <h2>MyAnimeList</h2>
          <AccountSection
            authState={authState}
            isAuthLoading={isAuthLoading}
            authError={authError}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
          />
        </section>
        <section className="connections-section">
          <h2>SIMKL</h2>
          <SimklSection
            isConnected={simklConnected}
            userName={simklUser}
            isAuthLoading={isSimklAuthLoading}
            authError={simklAuthError}
            isSyncing={isSimklSyncing}
            syncMessage={simklSyncMessage}
            onConnect={onSimklConnect}
            onDisconnect={onSimklDisconnect}
            onSync={onSimklSync}
          />
        </section>
        <section className="connections-section">
          <h2>Sync</h2>
          <DataSyncSection
            authState={authState}
            isSyncing={isSyncing}
            isBigSyncing={isBigSyncing}
            isHistoricalCrawling={isHistoricalCrawling}
            syncError={syncError}
            historicalStats={historicalStats}
            onSync={onSync}
            onBigSync={onBigSync}
            onHistoricalCrawl={onHistoricalCrawl}
            isAnilistTagsSyncing={isAnilistTagsSyncing}
            anilistTagsSyncMessage={anilistTagsSyncMessage}
            anilistTagStats={anilistTagStats}
            onAnilistTagsSync={onAnilistTagsSync}
          />
        </section>
        <section className="connections-section">
          <ConnectionLogPanel />
        </section>
      </div>
      <style jsx>{`
        .connections-page { display: flex; flex-direction: column; gap: 1.5rem; max-width: 700px; }
        .connections-section { background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; }
        .connections-section h2 { margin: 0 0 0.75rem; font-size: 1.1rem; color: var(--text-primary); }
      `}</style>
    </>
  );
}
