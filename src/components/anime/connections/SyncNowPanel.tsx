import React from 'react';
import styles from './SyncNowPanel.module.css';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

export type SyncNowStatus = 'idle' | 'started' | 'alreadyRunning' | 'error';

interface SyncNowPanelProps {
  /** A run is in flight — the server's own lock state, polled, not local optimism. */
  running: boolean;
  status: SyncNowStatus;
  /** Every other action on the page is busy — same gate the provider cards use. */
  busy: boolean;
  onSync: () => void;
}

/**
 * "Tout synchroniser" — runs the nine steps the 02:00 cron job runs, now.
 *
 * It sits ABOVE both role groups rather than inside one, because it is the only
 * control on this page that belongs to no single provider: it spans all of them.
 * Every card below is still individually pressable — this is the shortcut, not a
 * replacement.
 *
 * **`running` comes from the server**, polled off `GET /api/anime/sync-now`, not
 * from a local `isSyncing` flag like the per-provider buttons use. Those await
 * their fetch; this one is fire-and-forget over a multi-minute run, so a local
 * flag would clear on reload and show an idle button mid-run. Polling the lock
 * also means the button correctly reads "running" when it was the 02:00 cron
 * that started it.
 *
 * There is no progress bar on purpose: the connection log panel to the right is
 * already the transport (`appendLog('cron-sync', …)`), and it reports per-step
 * outcomes a bar could not.
 */
const SyncNowPanel: React.FC<SyncNowPanelProps> = ({ running, status, busy, onSync }) => {
  const t = useT();

  const message = running
    ? t('syncNow.running')
    : status === 'error'
      ? t('syncNow.error')
      : status === 'started' || status === 'alreadyRunning'
        ? t('syncNow.done')
        : t('syncNow.hint');

  return (
    <section className={styles.panel}>
      <div className={styles.text}>
        <h2 className={styles.title}>{t('syncNow.title')}</h2>
        <p className={status === 'error' ? styles.error : styles.hint}>{message}</p>
      </div>
      <Button onClick={onSync} disabled={running || busy}>
        {running ? t('syncNow.buttonRunning') : t('syncNow.button')}
      </Button>
    </section>
  );
};

export default SyncNowPanel;
