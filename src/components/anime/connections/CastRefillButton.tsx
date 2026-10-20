import React, { useCallback, useEffect, useState } from 'react';
import styles from './ProviderActions.module.css';
import { Button } from '@/components/shared';
import { useT } from '@/lib/i18n';

/**
 * TEMPORARY — one press refills every cast entry still cut at the old
 * 25-character cap. Self-contained (its own fetch, no props) so removing it is
 * deleting this file, its one mount, the route and the four locale keys.
 */
export const CastRefillButton: React.FC = () => {
  const t = useT();
  const [state, setState] = useState<{ truncated: number; running: boolean } | null>(null);
  const [started, setStarted] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/anilist/cast-refill');
      if (res.ok) setState(await res.json());
    } catch {
      // Non-fatal: the button just stays without a count.
    }
  }, []);

  useEffect(() => {
    void load();
    // Poll while a run is going, so the count visibly falls.
    if (!started && !state?.running) return;
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load, started, state?.running]);

  const start = async () => {
    setStarted(true);
    await fetch('/api/anime/anilist/cast-refill', { method: 'POST' });
    void load();
  };

  const running = started || state?.running === true;
  const done = state !== null && state.truncated === 0;
  return (
    <>
      <div className={styles.buttonGroup}>
        <Button onClick={start} disabled={running || done} variant="secondary">
          {running ? t('dataSync.castRefillRunning') : t('dataSync.castRefill')}
        </Button>
      </div>
      {state !== null && (
        <div className={styles.stats}>
          {done ? t('dataSync.castRefillDone') : t('dataSync.castRefillCount', { count: state.truncated })}
        </div>
      )}
    </>
  );
};
