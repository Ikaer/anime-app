import { useEffect, useState } from 'react';
import type { AniListCharacterEntry } from '@/models/anime';
import { useT } from '@/lib/i18n';
import styles from './CastSection.module.css';

interface CastResponse {
  ok: boolean;
  cached: boolean;
  characters: AniListCharacterEntry[];
  error?: string;
}

export interface CastSectionProps {
  animeId: string;
  /**
   * Cast from the slice, passed through by `getServerSideProps`. `null` means
   * "not cached yet" (as opposed to `[]`, "AniList has none"), which is what
   * triggers the one-time fetch below.
   */
  initialCast: AniListCharacterEntry[] | null;
}

/** First letter(s) of a name, for the placeholder when AniList has no portrait. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('');
}

/**
 * Cast — characters and their Japanese voice actors (seiyuu), from AniList.
 *
 * Unlike the sibling `MoreLikeThis` block (click-to-load, because it costs two
 * external round-trips every time it's opened), this auto-fetches on mount when
 * the title has no cached cast. It's a single cheap request that happens at most
 * ONCE per title in the app's lifetime — after that the entry is in
 * `catalog/anilist_cast.json` and arrives with the server render. Cast is also
 * core detail-page content rather than an optional drill-down, so hiding it
 * behind a button would cost a click on every first view for no saving.
 *
 * Layout mirrors the convention AniList/MAL both use: the character faces in
 * from the left, its voice actor faces in from the right.
 */
export default function CastSection({ animeId, initialCast }: CastSectionProps) {
  const t = useT();
  const [cast, setCast] = useState<AniListCharacterEntry[] | null>(initialCast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // The detail page's RefreshButton force-refetches cast, then re-runs
  // getServerSideProps via router.replace — which hands us a NEW `initialCast`
  // without remounting. `useState(initialCast)` only reads its argument on
  // mount, so without this the refreshed cast would stay invisible until a full
  // page reload. Guarded on non-null so a re-render of a not-yet-cached title
  // can't wipe out a cast we just fetched client-side.
  useEffect(() => {
    if (initialCast !== null) setCast(initialCast);
  }, [initialCast]);

  useEffect(() => {
    // Already have it (possibly an empty cast — that's an answer, not a miss).
    if (cast !== null) return;
    let cancelled = false;
    setBusy(true);
    fetch(`/api/anime/animes/${animeId}/cast`)
      .then(async res => {
        const data: CastResponse = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (!cancelled) setCast(data.characters);
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('cast.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => { cancelled = true; };
    // Only ever runs for the initial miss; `cast` is intentionally not a dep,
    // since setting it is this effect's own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeId]);

  // Nothing to show and nothing pending: AniList has no cast for this title.
  // Render nothing rather than an empty panel, same as the tags/staff section.
  if (!busy && !error && cast !== null && cast.length === 0) return null;

  const VISIBLE = 12;
  const shown = cast && !expanded ? cast.slice(0, VISIBLE) : cast ?? [];
  const hiddenCount = cast ? cast.length - shown.length : 0;

  return (
    <section className={styles.section}>
      <h2>{cast ? t('cast.headingCount', { count: cast.length }) : t('cast.heading')}</h2>

      {busy && <p className={styles.note}>{t('cast.loading')}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.grid}>
        {shown.map(c => (
          <div key={c.id} className={styles.row}>
            <a
              className={styles.side}
              href={`https://anilist.co/character/${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {c.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className={styles.avatar} src={c.image} alt={c.name} loading="lazy" />
                : <span className={styles.avatarFallback}>{initials(c.name)}</span>}
              <span className={styles.who}>
                <span className={styles.name}>{c.name}</span>
                {c.role && (
                  <span className={`${styles.role} ${c.role === 'MAIN' ? styles.roleMain : ''}`}>
                    {c.role === 'MAIN' ? t('cast.roleMain') : c.role === 'SUPPORTING' ? t('cast.roleSupporting') : c.role}
                  </span>
                )}
              </span>
            </a>

            {/* Every seiyuu, not just the first: a character voiced by two
                people is common and meaningful (a child self and an adult inner
                monologue, a mid-series recast), and showing one silently drops
                the other. */}
            {c.voiceActors.length > 0 ? (
              <span className={styles.vaStack}>
                {c.voiceActors.map(va => (
                  <a
                    key={va.id}
                    className={`${styles.side} ${styles.sideRight}`}
                    href={`https://anilist.co/staff/${va.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className={`${styles.who} ${styles.whoRight}`}>
                      <span className={styles.name}>{va.name}</span>
                      {va.nameNative && <span className={styles.role}>{va.nameNative}</span>}
                    </span>
                    {va.image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img className={styles.avatar} src={va.image} alt={va.name} loading="lazy" />
                      : <span className={styles.avatarFallback}>{initials(va.name)}</span>}
                  </a>
                ))}
              </span>
            ) : (
              <span className={`${styles.side} ${styles.sideRight} ${styles.noVa}`}>
                <span className={`${styles.who} ${styles.whoRight}`}>
                  <span className={styles.role}>{t('cast.noVoiceActor')}</span>
                </span>
              </span>
            )}
          </div>
        ))}
      </div>

      {hiddenCount > 0 && (
        <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
          {t('cast.showAll', { count: hiddenCount })}
        </button>
      )}
    </section>
  );
}
