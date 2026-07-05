import { useState, useEffect } from 'react';
import Head from 'next/head';
import styles from './discrepancies.module.css';
import type { AnimeForDisplay, UserAnimeStatus } from '@/models/anime';

const STATUS_LABEL: Record<UserAnimeStatus, string> = {
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Plan',
};

const fmtStatus = (s: UserAnimeStatus | string | null | undefined): string =>
  s ? STATUS_LABEL[s as UserAnimeStatus] ?? String(s) : '—';

const malUrl = (id: number) => `https://myanimelist.net/anime/${id}`;
const simklUrl = (anime: AnimeForDisplay): string | null => {
  const simklId = anime.simkl?.simkl_id ?? anime.crosswalk?.simkl;
  return simklId ? `https://simkl.com/anime/${simklId}` : null;
};

/** Render a value, highlighting it when the MAL/SIMKL sides disagree. */
function Cell({ value, mismatch }: { value: React.ReactNode; mismatch?: boolean }) {
  const isEmpty = value === '—' || value === null || value === undefined || value === '';
  const cls = mismatch ? styles.mismatch : isEmpty ? styles.muted : undefined;
  return <span className={cls}>{isEmpty ? '—' : value}</span>;
}

export default function DiscrepanciesPage() {
  const [animes, setAnimes] = useState<AnimeForDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoading(true);
        setError('');
        const res = await fetch('/api/anime/animes?discrepancies=true&limit=all&sortBy=title&sortDir=asc');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load discrepancies');
        }
        const data = await res.json();
        if (!cancelled) setAnimes(data.animes || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load discrepancies');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Head>
        <title>MAL/SIMKL discrepancies</title>
      </Head>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>MAL/SIMKL discrepancies</h1>
          {!isLoading && !error && (
            <span className={styles.count}>{animes.length} title{animes.length === 1 ? '' : 's'}</span>
          )}
        </div>

        {isLoading && <div className={styles.state}>Loading…</div>}
        {error && <div className={styles.error}>{error}</div>}

        {!isLoading && !error && animes.length === 0 && (
          <div className={styles.state}>No discrepancies between MAL and SIMKL. 🎉</div>
        )}

        {!isLoading && !error && animes.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Title</th>
                  <th className={styles.groupMal}>MAL status</th>
                  <th>SIMKL status</th>
                  <th className={styles.groupMal}>MAL score</th>
                  <th>SIMKL score</th>
                  <th className={styles.groupMal}>MAL ep</th>
                  <th>SIMKL ep</th>
                  <th>Links</th>
                </tr>
              </thead>
              <tbody>
                {animes.map(anime => {
                  const d = anime.discrepancy;
                  const mal = anime.my_list_status;
                  const simkl = anime.simkl;
                  const img = anime.main_picture?.medium || anime.main_picture?.large;
                  const sUrl = simklUrl(anime);
                  const simklOnly = d?.presence === 'simkl_only';

                  return (
                    <tr key={anime.id}>
                      <td>
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={styles.thumb} src={img} alt="" loading="lazy" />
                        ) : (
                          <div className={styles.thumbPlaceholder} />
                        )}
                      </td>
                      <td className={styles.titleCell}>
                        {anime.title}
                        {simklOnly && (
                          <>
                            {' '}
                            <span className={styles.presenceTag}>SIMKL only</span>
                          </>
                        )}
                      </td>
                      <td className={styles.groupMal}>
                        <Cell value={fmtStatus(mal?.status)} mismatch={!!d?.status || simklOnly} />
                      </td>
                      <td>
                        <Cell value={fmtStatus(simkl?.status)} mismatch={!!d?.status || simklOnly} />
                      </td>
                      <td className={styles.groupMal}>
                        <Cell value={mal?.score ? mal.score : '—'} mismatch={!!d?.score} />
                      </td>
                      <td>
                        <Cell value={simkl?.score != null ? simkl.score : '—'} mismatch={!!d?.score} />
                      </td>
                      <td className={styles.groupMal}>
                        <Cell
                          value={mal?.num_episodes_watched != null ? mal.num_episodes_watched : '—'}
                          mismatch={!!d?.progress}
                        />
                      </td>
                      <td>
                        <Cell
                          value={simkl?.num_episodes_watched != null ? simkl.num_episodes_watched : '—'}
                          mismatch={!!d?.progress}
                        />
                      </td>
                      <td>
                        <div className={styles.links}>
                          <a
                            className={styles.linkBtn}
                            href={malUrl(anime.id)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            MAL
                          </a>
                          {sUrl && (
                            <a
                              className={styles.linkBtn}
                              href={sUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              SIMKL
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
