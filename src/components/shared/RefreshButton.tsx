import { useState } from 'react';
import styles from './RefreshButton.module.css';
import { useT } from '@/lib/i18n';

type RefreshOutcome = {
  mal: { ok: boolean; error?: string };
  /** AniList's CATALOG pipe: tags / staff / banner / relations. */
  anilist: { ok: boolean; tagged: number; error?: string };
  /** AniList's PERSONAL pipe: the viewer's list import. `skipped` = not connected. */
  anilistPersonal: { ok: boolean; skipped?: boolean; imported: number; error?: string };
  simkl: { ok: boolean; phase: string; added: number; removed: number; error?: string };
};

export interface RefreshButtonProps {
  animeId: string;
  /**
   * Called after a successful refresh so the host can re-read the now-fresh data
   * (e.g. re-run getServerSideProps via router.replace, or re-fetch a list).
   */
  onRefreshed?: () => void | Promise<void>;
  /** Compact icon-only variant for dense contexts like table rows. */
  compact?: boolean;
}

/**
 * Triggers the per-anime refresh (MAL single-title + AniList tags/staff +
 * AniList list import + SIMKL incremental delta) and reports a compact
 * per-source outcome so a failed pipe is visible, not silent. The host decides
 * how to reflect the new data via `onRefreshed`.
 */
export default function RefreshButton({ animeId, onRefreshed, compact }: RefreshButtonProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/anime/animes/${animeId}/refresh`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RefreshOutcome;
      setResult(data);
      if (onRefreshed) await onRefreshed();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('refresh.failed'));
    } finally {
      setBusy(false);
    }
  }

  const flag = (ok: boolean) => (ok ? '✓' : '✗');

  // AniList runs two pipes (catalog metadata + the list import), but the badge
  // sits in a table cell and a fourth entry wraps it. One flag, the AND of both,
  // with the split in the tooltip — the failure mode this replaces is the badge
  // showing "AniList ✓" off the catalog refetch while the list never re-read.
  const anilistOk = result
    ? result.anilist.ok && (result.anilistPersonal.skipped || result.anilistPersonal.ok)
    : false;
  const tip = result
    ? [
        `MAL ${flag(result.mal.ok)}`,
        `AniList catalog ${flag(result.anilist.ok)}`,
        `AniList list ${result.anilistPersonal.skipped ? '–' : flag(result.anilistPersonal.ok)}`,
        `SIMKL ${flag(result.simkl.ok)}`,
      ].join(' · ')
    : '';

  return (
    <span className={styles.wrap}>
      <button
        className={`${styles.btn} ${compact ? styles.compact : ''}`}
        onClick={refresh}
        disabled={busy}
        title={t('refresh.title')}
      >
        {busy ? (compact ? '⏳' : t('refresh.refreshing')) : (compact ? '🔄' : t('refresh.refresh'))}
      </button>
      {result && (
        <span className={styles.status} title={tip}>
          MAL {flag(result.mal.ok)} · AniList {flag(anilistOk)} · SIMKL {flag(result.simkl.ok)}
        </span>
      )}
      {error && <span className={`${styles.status} ${styles.err}`}>{error}</span>}
    </span>
  );
}
