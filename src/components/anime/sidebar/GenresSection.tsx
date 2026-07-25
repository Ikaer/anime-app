import React, { useEffect, useMemo, useState } from 'react';
import styles from './GenresSection.module.css';
import { GENRE_AXES, type GenreAxis } from '@/lib/domain/genreAxis';
import { useT, type TranslationKey } from '@/lib/i18n';

/**
 * Genre filter, grouped by the three axes hiding inside `catalog.genres`
 * (`domain/genreAxis.ts`). One filter dimension, three presentation groups —
 * the axis is derived from the name, so nothing about the store or the URL
 * knows this split exists.
 *
 * The vocabulary comes from `GET /api/anime/genres` rather than a hardcoded
 * list: `genreAxis` knows which NAMES are genres or demographics, but only the
 * store knows which of them any title actually carries, and `theme` is
 * open-ended by construction.
 *
 * Three things the shape of the data forces:
 *  - **Ordered by frequency**, not alphabetically. A 78-value vocabulary has a
 *    long tail; `Action` must not sit below `Anthropomorphic`.
 *  - **Themes are capped** with a "show more". Genres (~19) and demographics (5)
 *    are closed sets that fit; themes are ~55 and would otherwise be a wall.
 *  - **Selected values are always rendered**, even when the search or the cap
 *    would hide them — a filter you cannot see is a filter you cannot clear.
 */

interface GenreFacet {
  name: string;
  count: number;
}

interface GenreVocabulary {
  axes: Record<GenreAxis, GenreFacet[]>;
  total: number;
}

const THEME_VISIBLE = 12;

interface GenresSectionProps {
  genres: string[];
  onGenresChange: (genres: string[]) => void;
}

const GenresSection: React.FC<GenresSectionProps> = ({ genres, onGenresChange }) => {
  const t = useT();
  const [vocabulary, setVocabulary] = useState<GenreVocabulary | null>(null);
  const [query, setQuery] = useState('');
  const [expandedThemes, setExpandedThemes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/anime/genres')
      .then(r => (r.ok ? r.json() : null))
      .then((data: GenreVocabulary | null) => { if (!cancelled && data) setVocabulary(data); })
      .catch(() => { /* the filter simply doesn't render — not worth an error state */ });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => new Set(genres), [genres]);

  const toggle = (name: string, checked: boolean) => {
    onGenresChange(checked ? [...genres, name] : genres.filter(g => g !== name));
  };

  const term = query.trim().toLowerCase();

  /**
   * What to render per axis: search-matching entries, capped for themes, with
   * every selected value forced back in (and pinned first) so a selection can
   * always be undone from where it is visible.
   */
  const visibleFor = (axis: GenreAxis, facets: GenreFacet[]): GenreFacet[] => {
    const matching = term ? facets.filter(f => f.name.toLowerCase().includes(term)) : facets;
    const capped = axis === 'theme' && !expandedThemes && !term
      ? matching.slice(0, THEME_VISIBLE)
      : matching;
    const shown = new Set(capped.map(f => f.name));
    const missingSelected = facets.filter(f => selected.has(f.name) && !shown.has(f.name));
    return [...missingSelected, ...capped];
  };

  if (!vocabulary) return null;

  return (
    <div className={styles.genresSection}>
      <input
        type="search"
        className={styles.search}
        placeholder={t('filters.genreSearch')}
        value={query}
        onChange={e => setQuery(e.target.value)}
        spellCheck={false}
      />

      {genres.length > 0 && (
        <button type="button" className={styles.clear} onClick={() => onGenresChange([])}>
          {t('filters.genreClear', { count: genres.length })}
        </button>
      )}

      {GENRE_AXES.map(axis => {
        const facets = vocabulary.axes[axis] || [];
        if (facets.length === 0) return null;
        const visible = visibleFor(axis, facets);
        if (visible.length === 0) return null;
        const hidden = axis === 'theme' && !expandedThemes && !term
          ? Math.max(0, facets.length - visible.length)
          : 0;

        return (
          <div key={axis} className={styles.axisGroup}>
            <div className={styles.axisLabel}>{t(`filters.genreAxis.${axis}` as TranslationKey)}</div>
            {visible.map(f => (
              <label key={f.name} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={selected.has(f.name)}
                  onChange={e => toggle(f.name, e.target.checked)}
                />
                <span className={styles.name}>{f.name}</span>
                <span className={styles.count}>{f.count}</span>
              </label>
            ))}
            {hidden > 0 && (
              <button type="button" className={styles.more} onClick={() => setExpandedThemes(true)}>
                {t('filters.genreShowMore', { count: hidden })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default GenresSection;
