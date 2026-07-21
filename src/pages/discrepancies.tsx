import { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import styles from './discrepancies.module.css';
import { RefreshButton } from '@/components/shared';
import type { AnimeRecord, Discrepancy, ProvenanceSource, ProviderPersonalState } from '@/models/anime';
import { getPrimaryTitle } from '@/lib/domain/animeUtils';
import { computeDiscrepancy } from '@/lib/providers/discrepancy';
import { useT, type TFunction, type TranslationKey } from '@/lib/i18n';

const fmtStatus = (s: string | null | undefined, t: TFunction): string =>
  s ? t(`statusShort.${s}` as TranslationKey) : '—';

/**
 * Grouped LONG format (docs/localRating/ phase 4): one sub-row per provider under
 * each anime, rather than a MAL/SIMKL column pair. This is what lets a fourth
 * provider land without blowing the table out sideways on the 4K screen.
 */
const PROVIDER_ORDER: ProvenanceSource[] = ['mal', 'simkl', 'local', 'anilist'];

const providerRows = (disc: Discrepancy): [ProvenanceSource, ProviderPersonalState][] =>
  PROVIDER_ORDER.filter(p => disc.providers[p]).map(p => [p, disc.providers[p]!]);

/**
 * URL state, one key: `px` = the providers to EXCLUDE from the comparison.
 * Excluding rather than including keeps "no param" unambiguously meaning "compare
 * everything", and still encodes the all-unchecked state (which legitimately
 * shows nothing — a discrepancy needs two providers to disagree).
 *
 * Inline rather than a `use*UrlState` hook like /tier or /quick-rate: those carry
 * a dozen narrowing filters, this is a single list and a hook file would be more
 * ceremony than state.
 */
const EXCLUDE_KEY = 'px';

/**
 * Re-run the comparison over the kept providers only.
 *
 * This is the whole point of the filter: dropping a provider's sub-row without
 * recomputing would leave titles in the table whose remaining providers all
 * agree. `computeDiscrepancy` is pure and client-safe precisely so it can run
 * here on the raw per-provider states the API already shipped — same function
 * the server used, so an empty exclusion set reproduces the server's result
 * exactly rather than approximating it.
 */
function refilter(
  animes: AnimeRecord[],
  excluded: Set<ProvenanceSource>
): { anime: AnimeRecord; disc: Discrepancy }[] {
  const out: { anime: AnimeRecord; disc: Discrepancy }[] = [];
  for (const anime of animes) {
    const providers = anime.discrepancy?.providers ?? {};
    const kept: Partial<Record<ProvenanceSource, ProviderPersonalState>> = {};
    for (const p of Object.keys(providers) as ProvenanceSource[]) {
      if (!excluded.has(p)) kept[p] = providers[p];
    }
    const disc = computeDiscrepancy(kept);
    if (disc) out.push({ anime, disc });
  }
  return out;
}

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
  const router = useRouter();
  const [animes, setAnimes] = useState<AnimeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const excluded = useMemo(() => {
    const raw = router.isReady ? router.query[EXCLUDE_KEY] : undefined;
    const list = typeof raw === 'string' ? raw.split(',') : [];
    return new Set(list.map(s => s.trim()).filter(Boolean) as ProvenanceSource[]);
  }, [router.isReady, router.query]);

  // Only offer providers that actually hold data — no dead AniList checkbox
  // before the anonymous import has run.
  const available = useMemo(() => {
    const seen = new Set<ProvenanceSource>();
    for (const a of animes) {
      for (const p of Object.keys(a.discrepancy?.providers ?? {}) as ProvenanceSource[]) seen.add(p);
    }
    return PROVIDER_ORDER.filter(p => seen.has(p));
  }, [animes]);

  const rows = useMemo(() => refilter(animes, excluded), [animes, excluded]);

  const toggleProvider = useCallback(
    (provider: ProvenanceSource) => {
      const next = new Set(excluded);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      const list = PROVIDER_ORDER.filter(p => next.has(p));
      const query = { ...router.query };
      if (list.length > 0) query[EXCLUDE_KEY] = list.join(',');
      else delete query[EXCLUDE_KEY];
      router.push({ pathname: '/discrepancies', query }, undefined, { shallow: true });
    },
    [excluded, router]
  );

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
            <span className={styles.count}>
              {t(rows.length === 1 ? 'discPage.countOne' : 'discPage.countOther', { count: rows.length })}
              {excluded.size > 0 && ` ${t('discPage.ofTotal', { total: animes.length })}`}
            </span>
          )}
        </div>

        {!isLoading && !error && available.length > 0 && (
          <div className={styles.filters}>
            <span className={styles.filterLabel}>{t('discPage.comparedSources')}</span>
            {available.map(p => {
              const on = !excluded.has(p);
              return (
                <label key={p} className={`${styles.check} ${on ? styles.checkOn : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleProvider(p)} />
                  {t(`disc.provider.${p}` as TranslationKey)}
                </label>
              );
            })}
            <span className={styles.filterHint}>{t('discPage.filterHint')}</span>
          </div>
        )}

        {isLoading && <div className={styles.state}>{t('common.loading')}</div>}
        {error && <div className={styles.error}>{error}</div>}

        {!isLoading && !error && rows.length === 0 && (
          <div className={styles.state}>
            {excluded.size > 0 && animes.length > 0 ? t('discPage.emptyFiltered') : t('discPage.empty')}
          </div>
        )}

        {!isLoading && !error && rows.length > 0 && (
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
                {rows.map(({ anime, disc: d }) => {
                  const img = anime.catalog.mainPicture?.medium || anime.catalog.mainPicture?.large;
                  const sUrl = simklUrl(anime);
                  const subRows = providerRows(d);
                  const absent = d.presence?.absent ?? [];

                  // The anime's own cells span its provider sub-rows; only the
                  // first sub-row carries them.
                  return subRows.map(([provider, s], i) => (
                    <tr key={`${anime.id}:${provider}`} className={i === 0 ? styles.groupStart : undefined}>
                      {i === 0 && (
                        <>
                          <td rowSpan={subRows.length}>
                            {img ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img className={styles.thumb} src={img} alt="" loading="lazy" />
                            ) : (
                              <div className={styles.thumbPlaceholder} />
                            )}
                          </td>
                          <td className={styles.titleCell} rowSpan={subRows.length}>
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
                        <Cell value={s.score ? s.score : '—'} mismatch={d.disagree.score} />
                      </td>
                      <td>
                        <Cell value={fmtStatus(s.status, t)} mismatch={d.disagree.status} />
                      </td>
                      <td>
                        <Cell
                          value={
                            s.progress != null
                              ? `${s.progress}${s.total ? ` / ${s.total}` : ''}`
                              : '—'
                          }
                          mismatch={d.disagree.progress}
                        />
                      </td>
                      {i === 0 && (
                        <>
                          <td rowSpan={subRows.length}>
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
                          <td rowSpan={subRows.length}>
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
