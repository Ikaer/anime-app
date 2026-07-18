import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import styles from './discrepancies.module.css';
import { RefreshButton } from '@/components/shared';
import type { AnimeRecord, ProvenanceSource, ProviderPersonalState } from '@/models/anime';
import { getPrimaryTitle } from '@/lib/animeUtils';
import { useT, type TFunction, type TranslationKey } from '@/lib/i18n';

const fmtStatus = (s: string | null | undefined, t: TFunction): string =>
  s ? t(`statusShort.${s}` as TranslationKey) : '—';

/**
 * Grouped LONG format (docs/localRating/ phase 4): one sub-row per provider under
 * each anime, rather than a MAL/SIMKL column pair. This is what lets a fourth
 * provider land without blowing the table out sideways on the 4K screen.
 */
const PROVIDER_ORDER: ProvenanceSource[] = ['mal', 'simkl', 'local', 'anilist'];

const providerRows = (anime: AnimeRecord): [ProvenanceSource, ProviderPersonalState][] => {
  const providers = anime.discrepancy?.providers ?? {};
  return PROVIDER_ORDER.filter(p => providers[p]).map(p => [p, providers[p]!]);
};

const malUrl = (id: number | string | undefined) => `https://myanimelist.net/anime/${id}`;
const simklUrl = (anime: AnimeRecord): string | null => {
  const simklId = anime.sources.simkl?.simkl_id ?? anime.crosswalk?.simkl;
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
  const [animes, setAnimes] = useState<AnimeRecord[]>([]);
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
                  <th className={styles.groupMal}>{t('discPage.provider')}</th>
                  <th>{t('discPage.score')}</th>
                  <th>{t('discPage.status')}</th>
                  <th>{t('discPage.episodes')}</th>
                  <th>{t('table.links')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {animes.map(anime => {
                  const d = anime.discrepancy;
                  const img = anime.catalog.mainPicture?.medium || anime.catalog.mainPicture?.large;
                  const sUrl = simklUrl(anime);
                  const rows = providerRows(anime);
                  const absent = d?.presence?.absent ?? [];

                  // The anime's own cells span its provider sub-rows; only the
                  // first sub-row carries them.
                  return rows.map(([provider, s], i) => (
                    <tr key={`${anime.id}:${provider}`} className={i === 0 ? styles.groupStart : undefined}>
                      {i === 0 && (
                        <>
                          <td rowSpan={rows.length}>
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className={styles.thumb} src={img} alt="" loading="lazy" />
                            ) : (
                              <div className={styles.thumbPlaceholder} />
                            )}
                          </td>
                          <td className={styles.titleCell} rowSpan={rows.length}>
                            {getPrimaryTitle(anime)}
                            {absent.length > 0 && (
                              <>
                                {' '}
                                <span className={styles.presenceTag}>
                                  {t('disc.absentFrom', {
                                    providers: absent
                                      .map(p => t(`disc.provider.${p}` as TranslationKey))
                                      .join(', '),
                                  })}
                                </span>
                              </>
                            )}
                          </td>
                        </>
                      )}
                      <td className={styles.groupMal}>
                        <span className={s.present ? undefined : styles.muted}>
                          {t(`disc.provider.${provider}` as TranslationKey)}
                          {!s.present && ` (${t('discPage.absent')})`}
                        </span>
                      </td>
                      <td>
                        <Cell value={s.score ? s.score : '—'} mismatch={!!d?.disagree.score} />
                      </td>
                      <td>
                        <Cell value={fmtStatus(s.status, t)} mismatch={!!d?.disagree.status} />
                      </td>
                      <td>
                        <Cell
                          value={
                            s.progress != null
                              ? `${s.progress}${s.total ? ` / ${s.total}` : ''}`
                              : '—'
                          }
                          mismatch={!!d?.disagree.progress}
                        />
                      </td>
                      {i === 0 && (
                        <>
                          <td rowSpan={rows.length}>
                            <div className={styles.links}>
                              <a
                                className={styles.linkBtn}
                                href={malUrl(anime.crosswalk.mal)}
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
                          <td rowSpan={rows.length}>
                            <RefreshButton animeId={anime.id} compact onRefreshed={load} />
                          </td>
                        </>
                      )}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
