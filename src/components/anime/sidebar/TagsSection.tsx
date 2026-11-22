import React, { useEffect, useMemo, useState } from 'react';
import styles from './GenresSection.module.css';
import {
  TAG_FILTER_MIN_RANK, TAG_GROUPS, type TagFacet, type TagGroup, type TagVocabulary,
} from '@/lib/domain/tagVocabulary';
import { useT, type TranslationKey } from '@/lib/i18n';

/**
 * AniList tag filter — `GenresSection`'s sibling, sharing its stylesheet and
 * its three rules (frequency order, capped groups, selected values always
 * rendered so a filter can always be cleared).
 *
 * What differs is scale: ~400 tags against ~80 genres, so EVERY group is
 * capped, not just one, and the search box is the main way in. Groups are
 * AniList's own top-level categories (`domain/tagVocabulary.ts`). Counts are
 * titles carrying the tag at rank >= `TAG_FILTER_MIN_RANK` — the exact set
 * the filter matches, which the hint under the search box says.
 */

const GROUP_VISIBLE = 8;

const GROUP_LABEL = {
  theme: 'filters.tagGroup.theme',
  setting: 'filters.tagGroup.setting',
  cast: 'filters.tagGroup.cast',
  demographic: 'filters.tagGroup.demographic',
  technical: 'filters.tagGroup.technical',
  sexual: 'filters.tagGroup.sexual',
  other: 'filters.tagGroup.other',
} satisfies Record<TagGroup, TranslationKey>;

interface TagsSectionProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
}

const TagsSection: React.FC<TagsSectionProps> = ({ tags, onTagsChange }) => {
  const t = useT();
  const [vocabulary, setVocabulary] = useState<TagVocabulary | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Partial<Record<TagGroup, boolean>>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/anime/tags')
      .then(r => (r.ok ? r.json() : null))
      .then((data: TagVocabulary | null) => { if (!cancelled && data) setVocabulary(data); })
      .catch(() => { /* the filter simply doesn't render */ });
    return () => { cancelled = true; };
  }, []);

  const selected = useMemo(() => new Set(tags), [tags]);
  const toggle = (name: string, checked: boolean) => {
    onTagsChange(checked ? [...tags, name] : tags.filter(x => x !== name));
  };

  const term = query.trim().toLowerCase();

  const visibleFor = (group: TagGroup, facets: TagFacet[]): TagFacet[] => {
    const matching = term ? facets.filter(f => f.name.toLowerCase().includes(term)) : facets;
    const capped = !expanded[group] && !term ? matching.slice(0, GROUP_VISIBLE) : matching;
    const shown = new Set(capped.map(f => f.name));
    const missingSelected = facets.filter(f => selected.has(f.name) && !shown.has(f.name));
    return [...missingSelected, ...capped];
  };

  if (!vocabulary || vocabulary.total === 0) return null;

  return (
    <div className={styles.genresSection}>
      <input
        type="search"
        className={styles.search}
        placeholder={t('filters.tagSearch')}
        value={query}
        onChange={e => setQuery(e.target.value)}
        spellCheck={false}
      />
      <div className={styles.count}>{t('filters.tagHint', { rank: TAG_FILTER_MIN_RANK })}</div>

      {tags.length > 0 && (
        <button type="button" className={styles.clear} onClick={() => onTagsChange([])}>
          {t('filters.genreClear', { count: tags.length })}
        </button>
      )}

      {TAG_GROUPS.map(group => {
        const facets = vocabulary.groups[group] || [];
        if (facets.length === 0) return null;
        const visible = visibleFor(group, facets);
        if (visible.length === 0) return null;
        const hidden = !expanded[group] && !term ? Math.max(0, facets.length - visible.length) : 0;

        return (
          <div key={group} className={styles.axisGroup}>
            <div className={styles.axisLabel}>{t(GROUP_LABEL[group])}</div>
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
              <button
                type="button"
                className={styles.more}
                onClick={() => setExpanded(prev => ({ ...prev, [group]: true }))}
              >
                {t('filters.genreShowMore', { count: hidden })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TagsSection;
