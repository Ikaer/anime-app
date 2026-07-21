import { useCallback, useState } from 'react';
import Link from 'next/link';
import type { RecoContribution } from '@/models/anime';
import type { SimilarItem } from '@/lib/reco/engine';
import { useI18n, TranslationKey } from '@/lib/i18n';
import styles from './MoreLikeThis.module.css';

interface SourceOutcome {
  ok: boolean;
  error?: string;
}

interface SimilarResponse {
  items: SimilarItem[];
  sources: { mal: SourceOutcome; anilist: SourceOutcome };
}

export interface MoreLikeThisProps {
  animeId: string;
}

/**
 * "Plus comme ça" — the crowd-recommendation drill-down for one title, fetched
 * on demand from `/api/anime/recommendations/similar/[id]`.
 *
 * Click-to-load on purpose: the detail page otherwise makes zero external calls,
 * and this block costs a MAL + an AniList round-trip.
 *
 * Distinct from the sibling "Dans le même studio / staff" block: that one is a
 * catalog-wide credit similarity, this one is what the two communities actually
 * recommend, re-ranked by what each candidate shares with this title.
 */
export default function MoreLikeThis({ animeId }: MoreLikeThisProps) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<SimilarItem[] | null>(null);
  const [sources, setSources] = useState<SimilarResponse['sources'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState<Set<string>>(new Set());

  const toggleExplain = useCallback((id: string) => {
    setExplainOpen(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/anime/recommendations/similar/${animeId}?lang=${lang}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setItems((data as SimilarResponse).items);
      setSources((data as SimilarResponse).sources);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('mlt.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  const renderExplain = (breakdown: RecoContribution[]) => {
    if (breakdown.length === 0) return null;
    const maxAbs = Math.max(...breakdown.map(r => Math.abs(r.contribution)), 0.0001);
    return (
      <div className={styles.explainPanel}>
        {breakdown.map(r => {
          const positive = r.contribution >= 0;
          return (
            <div key={r.source} className={styles.explainRow}>
              <div className={styles.explainHead}>
                <span className={styles.explainLabel}>{t(`reco.source.${r.source}.label` as TranslationKey)}</span>
                <span className={`${styles.explainValue} ${positive ? styles.explainPos : styles.explainNeg}`}>
                  {positive ? '+' : ''}{r.contribution.toFixed(2)}
                </span>
              </div>
              <div className={styles.explainBarTrack}>
                <div
                  className={`${styles.explainBar} ${positive ? styles.explainBarPos : styles.explainBarNeg}`}
                  style={{ width: `${(Math.abs(r.contribution) / maxAbs) * 100}%` }}
                />
              </div>
              {r.detail && <span className={styles.explainDetail}>{r.detail}</span>}
            </div>
          );
        })}
      </div>
    );
  };

  // A source that failed is worth naming: an empty block after a MAL 401 is not
  // the same statement as an empty block after two healthy sources.
  const failed = sources
    ? [
        !sources.mal.ok ? `MAL (${sources.mal.error})` : null,
        !sources.anilist.ok ? `AniList (${sources.anilist.error})` : null,
      ].filter(Boolean)
    : [];

  return (
    <section className={styles.section}>
      <h2>{t('mlt.title')}</h2>
      <p className={styles.sub}>{t('mlt.sub')}</p>

      {items === null && (
        <button className={styles.loadBtn} onClick={load} disabled={busy}>
          {busy ? t('mlt.loadingBtn') : t('mlt.loadBtn')}
        </button>
      )}

      {error && <div className={styles.error}>⚠ {error}</div>}

      {failed.length > 0 && (
        <div className={styles.warn}>⚠ {t('mlt.sourceUnavailable', { sources: failed.join(' · ') })}</div>
      )}

      {items !== null && items.length === 0 && !error && (
        <div className={styles.empty}>{t('mlt.empty')}</div>
      )}

      {items !== null && items.length > 0 && (
        <div className={styles.cards}>
          {items.map(item => (
            <div key={item.id} className={styles.card}>
              <Link href={`/anime/${item.id}`} className={styles.posterLink} title={item.title}>
                {item.poster
                  ? <img src={item.poster} alt="" className={styles.poster} />
                  : <div className={styles.noimg}>?</div>}
              </Link>
              <div className={styles.body}>
                <Link href={`/anime/${item.id}`} className={styles.title} title={item.title}>
                  {item.title}
                </Link>
                <div className={styles.meta}>
                  {item.mean != null && <span className={styles.mean}>★ {item.mean.toFixed(2)}</span>}
                  {item.mediaType && <span>{item.mediaType.toUpperCase()}</span>}
                  {item.year && <span>{item.year}</span>}
                  <span className={styles.affinity} title={t('mlt.affinityScore')}>{item.score.toFixed(2)}</span>
                </div>
                {item.status && (
                  <span className={`${styles.seen} ${item.seen ? styles.seenWatched : ''}`}>
                    {item.seen
                      ? `${t('mlt.alreadySeen')} · ${t(`statusShort.${item.status}` as TranslationKey)}`
                      : `📅 ${t(`statusShort.${item.status}` as TranslationKey)}`}
                  </span>
                )}
                {item.breakdown.length > 0 && (
                  <>
                    <button className={styles.explainBtn} onClick={() => toggleExplain(item.id)}>
                      {(explainOpen.has(item.id) ? '▾ ' : '▸ ') + t('card.why')}
                    </button>
                    {explainOpen.has(item.id) && renderExplain(item.breakdown)}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
