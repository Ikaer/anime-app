import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import type { AnimeRecord } from '@/models/anime';
import { getPrimaryTitle } from '@/lib/animeUtils';
import { useT } from '@/lib/i18n';
import styles from './AnimeRatePicker.module.css';

export default function AnimeRatePicker() {
  const t = useT();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AnimeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const handle = setTimeout(() => {
      fetch(`/api/anime/animes?search=${encodeURIComponent(term)}&limit=12`)
        .then(res => res.json())
        .then(data => {
          if (id !== requestId.current) return;
          setResults(data.animes || []);
          setLoading(false);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setResults([]);
          setLoading(false);
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const pick = (anime: AnimeRecord) => {
    // `/rate?id=` is deliberately MAL-id-keyed (see store.ts's getAnimeByIdForDisplay
    // doc comment) — `anime.id` is now the canonical id, so the MAL id must come
    // from the crosswalk.
    router.push({ pathname: '/rate', query: { id: anime.crosswalk.mal } });
  };

  return (
    <div className={styles.page}>
      <div className={styles.picker}>
        <h1 className={styles.title}>{t('calc.pickAnime')}</h1>
        <p className={styles.subtitle}>{t('calc.pickAnimePrompt')}</p>
        <input
          className={styles.searchInput}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('calc.searchPlaceholder')}
          autoFocus
        />
        {loading && <div className={styles.status}>{t('common.loading')}</div>}
        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div className={styles.status}>{t('calc.noResults')}</div>
        )}
        <div className={styles.results}>
          {results.map(anime => {
            const poster = anime.catalog.mainPicture?.medium || anime.catalog.mainPicture?.large;
            return (
              <button key={anime.id} className={styles.resultCard} onClick={() => pick(anime)}>
                {poster
                  ? <img className={styles.resultPoster} src={poster} alt="" />
                  : <div className={styles.resultPosterEmpty} />}
                <div className={styles.resultBody}>
                  <span className={styles.resultTitle}>{getPrimaryTitle(anime)}</span>
                  {anime.catalog.genres && anime.catalog.genres.length > 0 && (
                    <span className={styles.resultGenres}>{anime.catalog.genres.map(g => g.name).join(', ')}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
