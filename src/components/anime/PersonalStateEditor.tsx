import { useEffect, useState } from 'react';
import type { UserAnimeStatus } from '@/models/anime';
import { useT, type TranslationKey } from '@/lib/i18n';
import styles from './PersonalStateEditor.module.css';

/**
 * The **bootstrap surface** for personal state (docs/localRating/ phase 3).
 *
 * Every other rating surface assumes personal state already exists — the tier
 * board only fetches already-statused titles, and the reco feed needs completed
 * + scored seeds. This is the one control that takes an *unstatused catalog
 * title* to statused + scored, which is what first writes
 * `animes_local_personal.json` for a local-only user.
 *
 * All three controls go through the same `PUT …/mal-status` endpoint → the
 * `writePersonal` registry, so the edit fans out to whichever providers are
 * enabled and comes back with a per-provider outcome map. Rating and marking
 * watched stay two explicit acts — no auto-complete here (that's quick-rate's
 * whole point, not this page's).
 */

const STATUSES: UserAnimeStatus[] = ['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'];
const SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

interface WriteOutcome {
  ok: boolean;
  matched?: boolean;
  error?: string;
}

interface Props {
  animeId: string;
  /** The record's *effective* values — `getEffectiveStatus` is typed loosely
   *  (`string`), so compare rather than narrow. */
  status?: string;
  score?: number;
  progress?: number;
  numEpisodes?: number;
  /** No writable external provider connected — so clearing a status is safe
   *  (nothing remote to diverge from). See `PersonalPatch` in personalWriters. */
  canClearStatus: boolean;
  /** Re-run the page's `getServerSideProps` so the effective values re-read. */
  onWritten: () => void;
}

type Patch = { status?: UserAnimeStatus | null; score?: number; num_episodes_watched?: number };

export default function PersonalStateEditor({
  animeId, status, score, progress, numEpisodes, canClearStatus, onWritten,
}: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, WriteOutcome> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progressDraft, setProgressDraft] = useState<string>(progress != null ? String(progress) : '');

  // The page re-runs `getServerSideProps` after every write, so re-seed the draft
  // from the authoritative value — otherwise a rejected/failed edit would leave
  // the box showing a number the store never took.
  useEffect(() => {
    setProgressDraft(progress != null ? String(progress) : '');
  }, [progress]);

  async function send(patch: Patch) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/anime/animes/${animeId}/mal-status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || t('personalEdit.writeFailed'));
        return;
      }
      setOutcomes(data.outcomes || {});
      onWritten();
    } catch {
      setError(t('personalEdit.writeFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Only remote pushes can fail here — the local-cache authority write already
  // landed — so a failed provider means "didn't reach the service", not "lost".
  const failed = Object.entries(outcomes || {}).filter(([, o]) => o.ok === false);

  return (
    <div className={styles.editor}>
      <div className={styles.row}>
        <span className={styles.label}>{t('personalEdit.status')}</span>
        <div className={styles.controls}>
          {STATUSES.map(s => (
            <button
              key={s}
              type="button"
              disabled={busy}
              className={`${styles.chip} ${status === s ? styles.active : ''}`}
              onClick={() => send({ status: s })}
            >
              {t(`statusShort.${s}` as TranslationKey)}
            </button>
          ))}
          {canClearStatus && status && (
            <button
              type="button"
              disabled={busy}
              className={`${styles.chip} ${styles.clear}`}
              onClick={() => send({ status: null })}
            >
              {t('personalEdit.clearStatus')}
            </button>
          )}
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t('personalEdit.score')}</span>
        <div className={styles.controls}>
          {SCORES.map(n => (
            <button
              key={n}
              type="button"
              disabled={busy}
              className={`${styles.chip} ${styles.num} ${score === n ? styles.active : ''}`}
              onClick={() => send({ score: n })}
            >
              {n}
            </button>
          ))}
          {score != null && score > 0 && (
            <button
              type="button"
              disabled={busy}
              className={`${styles.chip} ${styles.clear}`}
              onClick={() => send({ score: 0 })}
            >
              {t('personalEdit.clearScore')}
            </button>
          )}
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t('personalEdit.progress')}</span>
        <div className={styles.controls}>
          <input
            className={styles.epInput}
            type="number"
            min={0}
            max={numEpisodes || undefined}
            value={progressDraft}
            disabled={busy}
            onChange={e => setProgressDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            // Commit on blur, not per-keystroke: each write is a full provider fan-out.
            onBlur={() => {
              const n = parseInt(progressDraft, 10);
              if (Number.isNaN(n) || n < 0 || n === (progress ?? 0)) {
                setProgressDraft(progress != null ? String(progress) : '');
                return;
              }
              send({ num_episodes_watched: n });
            }}
          />
          {numEpisodes ? <span className={styles.total}>/ {numEpisodes}</span> : null}
          <button
            type="button"
            disabled={busy || (numEpisodes ? (progress ?? 0) >= numEpisodes : false)}
            className={styles.chip}
            onClick={() => {
              const next = (progress ?? 0) + 1;
              setProgressDraft(String(next));
              send({ num_episodes_watched: next });
            }}
          >
            {t('personalEdit.plusOne')}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {failed.length > 0 && (
        <div className={styles.error}>
          {failed.map(([provider, o]) => (
            <div key={provider}>{t('personalEdit.providerFailed', { provider: provider.toUpperCase() })} {o.error || ''}</div>
          ))}
        </div>
      )}
    </div>
  );
}
