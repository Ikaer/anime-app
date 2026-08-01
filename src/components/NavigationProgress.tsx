import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import styles from './NavigationProgress.module.css';

// Nothing shows before this: an instant transition must not flash a bar.
const SHOW_DELAY_MS = 120;
const TRICKLE_MS = 300;
const FADE_OUT_MS = 400;

/**
 * Feedback for in-flight navigations, mounted once in `Layout`.
 *
 * Every page here is `getServerSideProps`-backed, and a cold detail page can
 * take several seconds while the ~40MB slices are parsed — during which Next
 * keeps the current page fully rendered and interactive, so a click reads as
 * "nothing happened". Two signals, both driven by `router.events` so they cover
 * every navigation source (global search, cards, related, credits, nav links):
 * a top progress bar, and — for a real page change only — a dimmed, inert
 * `.main` plus a `progress` cursor (see the `route-loading*` rules in
 * globals.css).
 */
export default function NavigationProgress() {
  const router = useRouter();
  // null while idle, 0-100 once the bar is on screen.
  const [progress, setProgress] = useState<number | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trickleTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stopTimers = () => {
      if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
      if (trickleTimer.current) { clearInterval(trickleTimer.current); trickleTimer.current = null; }
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    };

    const start = (url: string) => {
      stopTimers();
      // A filter update rewrites the query of the page you are already looking
      // at — worth a bar, not worth dimming what you are reading.
      const pageChange = url.split(/[?#]/)[0] !== window.location.pathname;
      showTimer.current = setTimeout(() => {
        setProgress(8);
        document.body.classList.add('route-loading');
        if (pageChange) document.body.classList.add('route-loading-page');
        trickleTimer.current = setInterval(() => {
          // Eases towards 90% without reaching it, so the bar always has
          // somewhere left to go however long the server takes.
          setProgress(p => (p == null ? p : p + (90 - p) * 0.12));
        }, TRICKLE_MS);
      }, SHOW_DELAY_MS);
    };

    const finish = () => {
      stopTimers();
      document.body.classList.remove('route-loading', 'route-loading-page');
      // Never mint a bar the start never showed — a sub-120ms navigation ends here.
      setProgress(p => (p == null ? null : 100));
      hideTimer.current = setTimeout(() => setProgress(null), FADE_OUT_MS);
    };

    router.events.on('routeChangeStart', start);
    router.events.on('routeChangeComplete', finish);
    router.events.on('routeChangeError', finish);
    return () => {
      router.events.off('routeChangeStart', start);
      router.events.off('routeChangeComplete', finish);
      router.events.off('routeChangeError', finish);
      stopTimers();
      document.body.classList.remove('route-loading', 'route-loading-page');
    };
  }, [router.events]);

  if (progress == null) return null;

  return (
    <div
      className={`${styles.bar} ${progress >= 100 ? styles.done : ''}`}
      style={{ width: `${progress}%` }}
      role="progressbar"
      aria-hidden="true"
    />
  );
}
