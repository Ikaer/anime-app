import React from 'react';
import styles from './SyncNowPanel.module.css';
import { Button } from '@/components/shared';
import { useI18n, useT, type Lang, type TranslationKey } from '@/lib/i18n';
import type { CronFreshness } from '@/lib/domain/cronFreshness';

export type SyncNowStatus = 'idle' | 'started' | 'alreadyRunning' | 'error';

interface SyncNowPanelProps {
  /** A run is in flight — the server's own lock state, polled, not local optimism. */
  running: boolean;
  status: SyncNowStatus;
  /** Every other action on the page is busy — same gate the provider cards use. */
  busy: boolean;
  /** Health of the 02:00 job. `null` until the first poll lands. */
  freshness: CronFreshness | null;
  onSync: () => void;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "il y a 7 heures" / "7 hours ago", from the browser rather than the
 * dictionaries: `Intl.RelativeTimeFormat` already knows both languages, and a
 * hand-rolled version would need a plural rule per language per unit.
 *
 * Safe against hydration mismatch only because `freshness` is null until the
 * client poll returns — this never runs during SSR, and must not be moved
 * anywhere that does.
 */
function relative(timestamp: number, lang: Lang): string {
  const diff = timestamp - Date.now();
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY * 2) return rtf.format(Math.round(diff / HOUR), 'hour');
  return rtf.format(Math.round(diff / DAY), 'day');
}

/**
 * Is the 02:00 job alive?
 *
 * ⚠️ This is the only thing on the page that reports a NON-event. Both real cron
 * outages were silent — an 11-day 401 nobody was looking for, and a truncated
 * crontab that logged literally nothing — and the second is why the panel must
 * say something in the `silent` case rather than simply showing no news. The
 * verdict itself is `computeCronFreshness`; this only renders it.
 *
 * `data-level` drives the colour so the mapping lives in CSS: several levels
 * share a colour (they differ by what to DO, not by how bad they are), and a
 * ternary chain in the markup would obscure that.
 */
const CronFreshnessBlock: React.FC<{ freshness: CronFreshness }> = ({ freshness }) => {
  const t = useT();
  const { lang } = useI18n();

  const lines: string[] = [];
  if (freshness.rejection) {
    lines.push(t('cronFreshness.rejectedSince', {
      when: relative(freshness.rejection.at, lang),
      reason: t(`cronFreshness.reason.${freshness.rejection.reason}` as TranslationKey),
    }));
  }
  if (freshness.lastCronAt != null) {
    lines.push(t('cronFreshness.lastRun', { when: relative(freshness.lastCronAt, lang) }));
  }
  if (freshness.failedSteps?.length) {
    lines.push(t('cronFreshness.failedSteps', { steps: freshness.failedSteps.join(', ') }));
  }
  // Shown last, and phrased so it is clear it did not count: someone pressing
  // "Tout synchroniser" while investigating a dead cron needs to see that the
  // verdict above ignored their press.
  if (freshness.lastManualAt != null) {
    lines.push(t('cronFreshness.manualRun', { when: relative(freshness.lastManualAt, lang) }));
  }

  return (
    <div className={styles.freshness} data-level={freshness.level}>
      <span className={styles.dot} aria-hidden="true" />
      <div className={styles.freshnessText}>
        <span className={styles.freshnessTitle}>{t('cronFreshness.title')}</span>
        <span className={styles.freshnessVerdict}>
          {t(`cronFreshness.level.${freshness.level}` as TranslationKey)}
        </span>
        {lines.map(line => (
          <span key={line} className={styles.freshnessDetail}>{line}</span>
        ))}
      </div>
    </div>
  );
};

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
 * The freshness block rides on that same poll — the two facts belong together
 * ("is a run in flight" and "did the scheduled one land"), and it costs no extra
 * request.
 *
 * There is no progress bar on purpose: the connection log panel to the right is
 * already the transport (`appendLog('cron-sync', …)`), and it reports per-step
 * outcomes a bar could not.
 */
const SyncNowPanel: React.FC<SyncNowPanelProps> = ({ running, status, busy, freshness, onSync }) => {
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
      <div className={styles.row}>
        <div className={styles.text}>
          <h2 className={styles.title}>{t('syncNow.title')}</h2>
          <p className={status === 'error' ? styles.error : styles.hint}>{message}</p>
        </div>
        <Button onClick={onSync} disabled={running || busy}>
          {running ? t('syncNow.buttonRunning') : t('syncNow.button')}
        </Button>
      </div>
      {freshness && <CronFreshnessBlock freshness={freshness} />}
    </section>
  );
};

export default SyncNowPanel;
