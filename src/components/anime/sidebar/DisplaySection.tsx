import React from 'react';
import styles from './DisplaySection.module.css';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

/**
 * Card-grid display controls — cards per row, and nothing else.
 *
 * **This edits a DEFAULT, not URL state.** Cards-per-row is a preference: it is
 * stored in `settings.json` (see lib/url/viewDefaults.ts) and applies to `/`,
 * `/recommendations` and `/mix` at once. The `cpr` URL key it used to write was
 * removed — a card size nobody wants to vary per bookmark had no business being
 * in a shareable URL, and the key only created the question of what an absent
 * one meant. It is also settable on `/settings`; this is the same value.
 *
 * It used to carry an "image size" button row too. That only ever sized the
 * table's thumbnails: `AnimeCardView` accepted the prop and never read it, its
 * grid being `minmax(280px, 1fr)` or an explicit `cardsPerRow`. So the buttons
 * went dead the moment the table was removed, and cards-per-row already answers
 * "how big are the cards". `/tier`'s thumbnail-size buttons are a separate,
 * genuinely wired control — they are not this.
 */
interface DisplaySectionProps {
  cardsPerRow: number | null;
  /** Persists the default. Debounced by this component, not the caller. */
  onCardsPerRowChange: (value: number | null) => void;
  /**
   * `stack` (default) is the sidebar's vertical group — still how
   * `/recommendations` and `/tier` render it. `inline` is the same markup laid
   * out as one row for `AnimeListHeader`, a CSS switch only.
   */
  variant?: 'stack' | 'inline';
}

/** Long enough that typing "12" doesn't persist "1" on the way. */
const SAVE_DEBOUNCE_MS = 500;

const DisplaySection: React.FC<DisplaySectionProps> = ({
  cardsPerRow,
  onCardsPerRowChange,
  variant = 'stack',
}) => {
  const t = useT();

  // The field is uncontrolled between keystrokes: `draft` echoes typing at once
  // while the persisted value follows on the debounce, so the grid doesn't
  // reflow per character and a half-typed "1" never reaches the store.
  const [draft, setDraft] = React.useState<string>(cardsPerRow?.toString() ?? '');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt the stored value whenever it changes from elsewhere (the initial fetch
  // resolving, or a save on /settings) — but never while an edit is pending, or
  // the in-flight keystroke would be overwritten mid-type.
  React.useEffect(() => {
    if (timer.current === null) setDraft(cardsPerRow?.toString() ?? '');
  }, [cardsPerRow]);

  React.useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const commit = React.useCallback((value: number | null) => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      onCardsPerRowChange(value);
    }, SAVE_DEBOUNCE_MS);
  }, [onCardsPerRowChange]);

  const handleCardsPerRowInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.trim();
    setDraft(e.target.value);
    if (raw === '') {
      commit(null);
      return;
    }
    const n = parseInt(raw, 10);
    commit(Number.isFinite(n) && n > 0 ? n : null);
  };

  const handleClear = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setDraft('');
    onCardsPerRowChange(null);
  };

  return (
    <div className={`${styles.displaySection} ${variant === 'inline' ? styles.inline : ''}`}>
      <label className={styles.label}>{t('display.cardsPerRow')}</label>
      <div className={styles.cardsPerRow}>
        <input
          type="number"
          min={1}
          step={1}
          value={draft}
          onChange={handleCardsPerRowInput}
          placeholder={t('display.auto')}
          className={styles.cardsPerRowInput}
          aria-label={t('display.cardsPerRow')}
          title={t('display.savedAsDefault')}
        />
        <Button
          variant="secondary"
          size="xs"
          className={styles.clearButton}
          onClick={handleClear}
          disabled={cardsPerRow === null && draft === ''}
        >
          {t('common.clear')}
        </Button>
      </div>
    </div>
  );
};

export default DisplaySection;
