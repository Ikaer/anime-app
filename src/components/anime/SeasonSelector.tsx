import React, { useMemo, useState } from 'react';
import styles from './SeasonSelector.module.css';
import { getSeasonInfos } from '@/lib/animeUtils';
import { useT, TranslationKey } from '@/lib/i18n';
import { Button } from '@/components/shared';
import type { SeasonInfo, SeasonName } from '@/models/anime';

interface SeasonSelectorProps {
  value: SeasonInfo[];
  onChange: (v: SeasonInfo[]) => void;
}

const SeasonSelector: React.FC<SeasonSelectorProps> = ({ value, onChange }) => {
  const t = useT();
  const infos = getSeasonInfos();
  const [showAdd, setShowAdd] = useState(false);
  const [season, setSeason] = useState<SeasonName>('winter');
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [year, setYear] = useState<number>(currentYear);

  const addUnique = (s: SeasonInfo[]) => {
    const key = (x: SeasonInfo) => `${x.year}-${x.season}`;
    const merged = [...value];
    for (const it of s) {
      if (!merged.find(m => key(m) === key(it))) merged.push(it);
    }
    onChange(merged);
  };

  const remove = (s: SeasonInfo) => {
    onChange(value.filter(v => !(v.year === s.year && v.season === s.season)));
  };

  const presets = (
    <div className={styles.row}>
      <Button variant="secondary" size="xs" onClick={() => addUnique([infos.current])}>{t('season.current')}</Button>
      <Button variant="secondary" size="xs" onClick={() => addUnique([infos.current, infos.previous])}>{t('season.currentPrev')}</Button>
      <Button variant="secondary" size="xs" onClick={() => addUnique([infos.next])}>{t('season.next')}</Button>
      <Button variant="secondary" size="xs" onClick={() => onChange([])}>{t('common.clear')}</Button>
      <Button variant="secondary" size="xs" onClick={() => setShowAdd(s => !s)}>
        {showAdd ? t('season.close') : t('season.add')}
      </Button>
    </div>
  );

  return (
    <div className={styles.container}>
      {presets}
      {showAdd && (
        <div className={styles.addRow}>
          <label>
            {t('season.seasonLabel')}
            <select value={season} onChange={(e) => setSeason(e.target.value as SeasonName)}>
              <option value="winter">{t('seasonName.winter')}</option>
              <option value="spring">{t('seasonName.spring')}</option>
              <option value="summer">{t('seasonName.summer')}</option>
              <option value="fall">{t('seasonName.fall')}</option>
            </select>
          </label>
          <label>
            {t('season.yearLabel')}
            <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value || currentYear.toString(), 10))} style={{width: 90}} />
          </label>
          <Button variant="secondary" size="xs" onClick={() => addUnique([{ year, season }])}>{t('season.addBtn')}</Button>
        </div>
      )}
      {value.length > 0 && (
        <div className={styles.chipsList}>
          {value.map((s, idx) => (
            <span key={idx} className={`${styles.chip} ${styles.chipActive}`}>
              {t(`seasonName.${s.season}` as TranslationKey)} {s.year}
              <Button variant="secondary" size="xs" className={styles.remove} onClick={() => remove(s)}>×</Button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default SeasonSelector;
