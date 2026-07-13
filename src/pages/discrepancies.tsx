import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import styles from './discrepancies.module.css';
import { RefreshButton } from '@/components/shared';
import type { AnimeForDisplay } from '@/models/anime';
import { getPrimaryTitle } from '@/lib/animeUtils';
import { useT, type TFunction, type TranslationKey } from '@/lib/i18n';

const fmtStatus = (s: string | null | undefined, t: TFunction): string =>
  s ? t(`statusShort.${s}` as TranslationKey) : '—';

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
  const t = useT();
  const [animes, setAnimes] = useState<AnimeForDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await fetch('/api/anime/animes?discrepancies=true&limit=all&sortBy=title&sortDir=asc');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('discPage.loadFailed'));
      }
      const data = await res.json();
      setAnimes(data.animes || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('discPage.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      await load();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <>
      <Head>
        <title>{t('nav.discrepancies')}</title>
      </Head>
      <div className={styles.page}>
        <div className={styles.header}>
          <h1 className={styles.title}>{t('nav.discrepancies')}</h1>
          {!isLoading && !error && (
            <span className={styles.count}>{t(animes.length === 1 ? 'discPage.countOne' : 'discPage.countOther', { count: animes.length })}</span>
          )}
        </div>

        {isLoading && <div className={styles.state}>{t('common.loading')}</div>}
        {error && <div className={styles.error}>{error}</div>}

        {!isLoading && !error && animes.length === 0 && (
          <div className={styles.state}>{t('discPage.empty')}</div>
        )}

        {!isLoading && !error && animes.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('table.image')}</th>
                  <th>{t('field.title')}</th>
                  <th className={styles.groupMal}>{t('discPage.malStatus')}</th>
                  <th>{t('discPage.simklStatus')}</th>
                  <th className={styles.groupMal}>{t('discPage.malScore')}</th>
                  <th>{t('discPage.simklScore')}</th>
                  <th className={styles.groupMal}>{t('discPage.malEp')}</th>
                  <th>{t('discPage.simklEp')}</th>
                  <th>{t('table.links')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {animes.map(anime => {
                  const d = anime.discrepancy;
                  const mal = anime.sources.mal?.my_list_status;
                  const simkl = anime.simkl;
                  const img = anime.catalog.mainPicture?.medium || anime.catalog.mainPicture?.large;
                  const sUrl = simklUrl(anime);
                  const simklOnly = d?.presence === 'simkl_only';

                  return (
                    <tr key={anime.canonicalId}>
                      <td>
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={styles.thumb} src={img} alt="" loading="lazy" />
                        ) : (
                          <div className={styles.thumbPlaceholder} />
                        )}
                      </td>
                      <td className={styles.titleCell}>
                        {getPrimaryTitle(anime)}
                        {simklOnly && (
                          <>
                            {' '}
                            <span className={styles.presenceTag}>{t('disc.simklOnly')}</span>
                          </>
                        )}
                      </td>
                      <td className={styles.groupMal}>
                        <Cell value={fmtStatus(mal?.status, t)} mismatch={!!d?.status || simklOnly} />
                      </td>
                      <td>
                        <Cell value={fmtStatus(simkl?.status, t)} mismatch={!!d?.status || simklOnly} />
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
                      <td>
                        <RefreshButton animeId={anime.canonicalId} compact onRefreshed={load} />
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
