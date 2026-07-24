import Head from 'next/head';
import { ConnectionLogPanel } from '@/components/anime';
import {
  ProviderCard,
  ProviderAccountControl,
  MalCatalogActions,
  AnilistCatalogActions,
  MalListActions,
  SimklListActions,
  AnilistListActions,
  LocalListActions,
} from '@/components/anime/connections';
import { useConnections } from '@/hooks';
import {
  providersWithRole,
  isExternalPersonalProvider,
  isWritableProvider,
} from '@/lib/providers/capabilities';
import { useT } from '@/lib/i18n';

/**
 * Connections.
 *
 * **Split by role, not by provider.** The axis the user thinks on is: what is my
 * catalog, and which lists am I syncing? Filing by provider instead puts
 * AniList's *anonymous* metadata sync under an account heading, which makes it
 * look like it needs a login. Both groups come from `providersWithRole`, so a
 * provider joins one by declaring the role in `PROVIDER_CAPABILITIES` and
 * nothing here changes.
 *
 * MAL and AniList appear in both groups on purpose — they hold both roles, with
 * different auth per role. The account control renders in the personal group
 * only; the catalog card states the requirement and points at it, so a
 * dual-role provider does not grow two disconnect buttons.
 */
export default function ConnectionsPage() {
  const t = useT();
  const { statuses, isStatusLoading, anyBusy, mal, simkl, anilist } = useConnections();

  const hasWritableExternal = Object.values(statuses).some(
    s => s && isExternalPersonalProvider(s.id) && isWritableProvider(s.id) && s.connected
  );

  const accountControl = (id: 'mal' | 'simkl' | 'anilist') => {
    const status = statuses[id];
    if (!status) return null;
    const group = id === 'mal' ? mal : id === 'simkl' ? simkl : anilist;
    return (
      <ProviderAccountControl
        status={status}
        isLoading={isStatusLoading}
        error={group.authError}
        onConnect={group.onConnect}
        onDisconnect={group.onDisconnect}
      />
    );
  };

  const catalogActions: Partial<Record<string, React.ReactNode>> = {
    mal: (
      <MalCatalogActions
        connected={!!statuses.mal?.connected}
        isBigSyncing={mal.isBigSyncing}
        isHistoricalCrawling={mal.isHistoricalCrawling}
        historicalStats={mal.historicalStats}
        error={mal.catalogSyncError}
        busy={anyBusy}
        onBigSync={mal.onBigSync}
        onHistoricalCrawl={mal.onHistoricalCrawl}
      />
    ),
    anilist: (
      <AnilistCatalogActions
        isMetaSyncing={anilist.isMetaSyncing}
        metaSyncMessage={anilist.metaSyncMessage}
        metaStats={anilist.metaStats}
        isCatalogCrawling={anilist.isCatalogCrawling}
        catalogCrawlMessage={anilist.catalogCrawlMessage}
        catalogStats={anilist.catalogStats}
        isCatalogSweeping={anilist.isCatalogSweeping}
        catalogSweepMessage={anilist.catalogSweepMessage}
        sweepStats={anilist.sweepStats}
        busy={anyBusy}
        onMetaSync={anilist.onMetaSync}
        onCatalogCrawl={anilist.onCatalogCrawl}
        onCatalogSweep={anilist.onCatalogSweep}
      />
    ),
  };

  const personalActions: Partial<Record<string, React.ReactNode>> = {
    mal: (
      <MalListActions
        connected={!!statuses.mal?.connected}
        isSyncing={mal.isSyncing}
        error={mal.listSyncError}
        busy={anyBusy}
        onSync={mal.onSync}
      />
    ),
    simkl: (
      <SimklListActions
        connected={!!statuses.simkl?.connected}
        isSyncing={simkl.isSyncing}
        message={simkl.syncMessage}
        busy={anyBusy}
        onSync={simkl.onSync}
      />
    ),
    anilist: (
      <AnilistListActions
        connected={!!statuses.anilist?.connected}
        isImporting={anilist.isImporting}
        importResult={anilist.importResult}
        importStoredCount={anilist.importStoredCount}
        pushStats={anilist.pushStats}
        busy={anyBusy}
        onImport={anilist.onPersonalImport}
        onPush={anilist.onPush}
      />
    ),
    local: (
      <LocalListActions
        enabled={!!statuses.local?.enabled}
        hasWritableExternal={hasWritableExternal}
      />
    ),
  };

  return (
    <>
      <Head>
        <title>{t('conn.pageTitle')}</title>
        <meta name="description" content={t('conn.metaDescription')} />
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <div className="connections-page">
        <div className="connections-col">
          <section className="connections-group">
            <h2>{t('conn.catalogRole')}</h2>
            <p className="group-hint">{t('conn.catalogRoleHint')}</p>
            {providersWithRole('catalog').map(id => (
              <ProviderCard
                key={`catalog-${id}`}
                status={statuses[id]}
                role="catalog"
                note={statuses[id]?.catalog?.auth === 'oauth' || statuses[id]?.catalog?.auth === 'oauth+secret'
                  ? t('conn.accountManagedBelow')
                  : undefined}
              >
                {catalogActions[id]}
              </ProviderCard>
            ))}
          </section>

          <section className="connections-group">
            <h2>{t('conn.personalRole')}</h2>
            <p className="group-hint">{t('conn.personalRoleHint')}</p>
            {providersWithRole('personal').map(id => (
              <ProviderCard
                key={`personal-${id}`}
                status={statuses[id]}
                role="personal"
                authControl={
                  id === 'mal' || id === 'simkl' || id === 'anilist' ? accountControl(id) : undefined
                }
              >
                {personalActions[id]}
              </ProviderCard>
            ))}
          </section>
        </div>
        <div className="connections-log">
          <ConnectionLogPanel />
        </div>
      </div>
      <style jsx>{`
        .connections-page { display: grid; grid-template-columns: minmax(340px, 480px) 1fr; gap: 1.5rem; align-items: stretch; height: calc(100vh - 144px); min-height: 500px; }
        .connections-col { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; overflow-y: auto; }
        .connections-log { display: flex; min-width: 0; min-height: 0; }
        .connections-group { display: flex; flex-direction: column; gap: 0.75rem; }
        .connections-group h2 { margin: 0; font-size: 1.1rem; color: var(--text-primary); }
        .group-hint { margin: -0.5rem 0 0; font-size: 0.85rem; color: var(--text-muted); }
        @media (max-width: 800px) {
          .connections-page { grid-template-columns: 1fr; height: auto; min-height: 0; }
          .connections-col { overflow-y: visible; }
          .connections-log { min-height: 500px; }
        }
      `}</style>
    </>
  );
}
