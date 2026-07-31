import React from 'react';
import styles from './SeasonFilter.module.css';
import SeasonPicker from './SeasonPicker';
import SeasonSelector from './SeasonSelector';
import { useSeasonSelectorMode } from '@/hooks/useSeasonSelectorMode';
import { useT } from '@/lib/i18n';
import type { SeasonInfo } from '@/models/anime';

/**
 * The season filter's one seam: it owns the simple/advanced choice and renders
 * `SeasonPicker` (default — one season, searchable, prev/next) or the legacy
 * multi-season `SeasonSelector`. Both write the same `SeasonInfo[]`, so the two
 * surfaces that host it (`/` and `/tier`) pass the same props either way and a
 * URL written in one mode is readable in the other.
 *
 * The mode is a `localStorage` preference (`useSeasonSelectorMode`), not a URL
 * key — it says how the control looks, not which anime are shown.
 */
interface SeasonFilterProps {
  value: SeasonInfo[];
  onChange: (v: SeasonInfo[]) => void;
}

const SeasonFilter: React.FC<SeasonFilterProps> = ({ value, onChange }) => {
  const t = useT();
  const [mode, setMode] = useSeasonSelectorMode();
  const simple = mode === 'simple';

  return (
    <div className={styles.wrapper}>
      {simple
        ? <SeasonPicker value={value} onChange={onChange} />
        : <SeasonSelector value={value} onChange={onChange} />}
      <button
        type="button"
        className={styles.modeToggle}
        onClick={() => setMode(simple ? 'advanced' : 'simple')}
      >
        {simple ? t('season.modeAdvanced') : t('season.modeSimple')}
      </button>
    </div>
  );
};

export default SeasonFilter;
