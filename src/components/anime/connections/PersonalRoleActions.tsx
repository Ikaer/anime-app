import React from 'react';
import Link from 'next/link';
import styles from './ProviderActions.module.css';
import { Button } from '@/components/shared';
import type { AniListPersonalImportResult } from '@/lib/providers/anilist/personalSync';
import type { AniListPushStats } from '@/lib/providers/anilist/push';
import { useT } from '@/lib/i18n';

/**
 * Personal-list-role actions, one block per provider
 * (docs/PROVIDER-PARITY.md E4) — "which lists am I syncing?", as opposed to
 * `CatalogRoleActions`' "what is my catalog?". MAL's list sync sat next to its
 * seasonal crawl purely because both were MAL.
 */

interface MalListActionsProps {
  connected: boolean;
  isSyncing: boolean;
  error: string;
  busy: boolean;
  onSync: () => void;
}

export const MalListActions: React.FC<MalListActionsProps> = ({ connected, isSyncing, error, busy, onSync }) => {
  const t = useT();
  return (
    <>
      <div className={styles.buttonGroup}>
        <Button onClick={onSync} disabled={!connected || busy}>
          {isSyncing ? t('dataSync.syncing') : t('dataSync.syncMal')}
        </Button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </>
  );
};

interface SimklListActionsProps {
  connected: boolean;
  isSyncing: boolean;
  message: string;
  busy: boolean;
  onSync: () => void;
}

export const SimklListActions: React.FC<SimklListActionsProps> = ({ connected, isSyncing, message, busy, onSync }) => {
  const t = useT();
  return (
    <>
      <div className={styles.buttonGroup}>
        <Button onClick={onSync} disabled={!connected || busy}>
          {isSyncing ? t('dataSync.syncing') : t('dataSync.syncSimkl')}
        </Button>
      </div>
      {message && <div className={styles.stats}>{message}</div>}
    </>
  );
};

interface AnilistListActionsProps {
  connected: boolean;
  isImporting: boolean;
  importResult: AniListPersonalImportResult | null;
  importStoredCount: number | null;
  pushStats: AniListPushStats | null;
  busy: boolean;
  onImport: () => void;
  onPush: () => void;
}

export const AnilistListActions: React.FC<AnilistListActionsProps> = ({
  connected, isImporting, importResult, importStoredCount, pushStats, busy, onImport, onPush,
}) => {
  const t = useT();

  const importMessage = (() => {
    if (!importResult) return null;
    if (importResult.ok) {
      return t('dataSync.anilistImportDone', {
        imported: importResult.imported,
        skipped: importResult.skippedNoMal,
      });
    }
    switch (importResult.errorKind) {
      case 'no_auth': return t('dataSync.anilistImportNoAuth');
      case 'not_found': return t('dataSync.anilistImportNotFound');
      default: return t('dataSync.anilistImportError');
    }
  })();

  return (
    <>
      <div className={styles.buttonGroup}>
        <Button onClick={onImport} disabled={busy || !connected} variant="secondary">
          {isImporting ? t('dataSync.anilistImporting') : t('dataSync.anilistImport')}
        </Button>
      </div>
      {importStoredCount !== null && importStoredCount > 0 && (
        <div className={styles.stats}>{t('dataSync.anilistImportStored', { count: importStoredCount })}</div>
      )}
      {importMessage && <div className={styles.stats}>{importMessage}</div>}

      {/* The one-shot backfill: only meaningful once connected, and silent when
          the two lists already agree — after the first run the per-edit writer
          keeps them in step. */}
      {pushStats?.connected && (
        <>
          {pushStats.pushRunning ? (
            <>
              <div className={styles.stats}>
                {t('anilistPush.running', {
                  index: String(pushStats.progress?.index ?? 0),
                  total: String(pushStats.progress?.total ?? 0),
                })}
              </div>
              <div className={styles.buttonGroup}>
                <Button variant="secondary" disabled>{t('anilistPush.button')}</Button>
              </div>
            </>
          ) : pushStats.differing > 0 ? (
            <>
              <div className={styles.stats}>
                {t('anilistPush.summary', {
                  differing: String(pushStats.differing),
                  statused: String(pushStats.statused),
                })}
              </div>
              <div className={styles.buttonGroup}>
                <Button onClick={onPush}>{t('anilistPush.button')}</Button>
              </div>
            </>
          ) : (
            <div className={styles.stats}>{t('anilistPush.inSync')}</div>
          )}
          {pushStats.error && <div className={styles.error}>{pushStats.error}</div>}
        </>
      )}
    </>
  );
};

interface LocalListActionsProps {
  enabled: boolean;
  /** True when a writable external provider is connected — why `auto` is off. */
  hasWritableExternal: boolean;
}

/**
 * `local` has no sync — it *is* the store. What it needs on this page (E3) is to
 * exist at all: to say that it is on (or why it is off), and where the switch
 * is. On the default keyless configuration it is the only active personal
 * provider, and it previously appeared nowhere but a settings key.
 */
export const LocalListActions: React.FC<LocalListActionsProps> = ({ enabled, hasWritableExternal }) => {
  const t = useT();
  return (
    <>
      <div className={styles.stats}>
        {enabled
          ? t('provider.localOnHint')
          : hasWritableExternal
            ? t('provider.localOffExternalHint')
            : t('provider.localOffHint')}
      </div>
      <div className={styles.buttonGroup}>
        <Link href="/settings" className={styles.link}>{t('provider.localSettingsLink')}</Link>
      </div>
    </>
  );
};
