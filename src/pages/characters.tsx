/**
 * `/characters` — « Mes personnages favoris », the registry.
 *
 * A collection surface, and deliberately nothing more. The favourite seiyuu it
 * is modelled on feed a reco source, the « Recommandé » mark and a list filter;
 * this one feeds nothing, because a character cannot carry that signal —
 * measured on the live store, 80.6% of characters appear in exactly one title
 * and only 1.8% of the recurring ones leave their franchise, so inverting a
 * favourite returns the show the owner already watched (see `CharacterFavorite`
 * in `@/models/anime`). Keeping a register was the ask; ranking was not.
 *
 * Read-and-unstar only: a character is FILED from an anime's cast section,
 * which is where the owner meets one and where the cast slice holds everything
 * the registry denormalizes. The ★ here can only undo.
 *
 * Sorting and search are component state, not URL keys. Neither says which
 * characters exist — they say how one page of a personal list is being read,
 * and nothing links into a sorted view of it. `/activity` makes the same call
 * for the same reason.
 */
import { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useCharacterFavorites } from '@/hooks/useCharacterFavorites';
import { useT, type TranslationKey } from '@/lib/i18n';

const SORTS = ['added', 'name', 'anime'] as const;
type Sort = (typeof SORTS)[number];

/**
 * ⚠️ A literal map rather than a `` t(`characters.sort.${s}` as TranslationKey) ``
 * dynamic key. That cast is exactly what disables the missing-key compile
 * check, and `satisfies` gives both directions back for free: a new sort is a
 * compile error until its string exists in `fr.json`, and a typo in the key is
 * one too. It also keeps this family out of `tests/i18n/dynamicKeys.test.ts`,
 * which only has to exist for the families that cannot be written this way.
 */
const SORT_KEYS = {
  added: 'characters.sortAdded',
  name: 'characters.sortName',
  anime: 'characters.sortAnime',
} satisfies Record<Sort, TranslationKey>;

/** First letter(s) of a name, for the placeholder when AniList has no portrait.
 *  Same helper as `CastSection` — four lines, and sharing it would mean a module
 *  for one string function. */
function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
}

export default function CharactersPage() {
  const t = useT();
  const { favorites, loaded, toggle } = useCharacterFavorites();
  const [sort, setSort] = useState<Sort>('added');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Matches every name the registry carries, not just the rendered one — the
    // app-wide search rule: you must be able to find an entry by a name it has.
    const rows = q
      ? favorites.filter(f =>
        f.name.toLowerCase().includes(q)
        || f.nameNative?.toLowerCase().includes(q)
        || f.animeTitle?.toLowerCase().includes(q)
        || f.voiceActors.some(va => va.name.toLowerCase().includes(q)))
      : favorites.slice();
    switch (sort) {
      case 'name': return rows.sort((a, b) => a.name.localeCompare(b.name));
      case 'anime': return rows.sort((a, b) =>
        (a.animeTitle ?? '').localeCompare(b.animeTitle ?? '') || a.name.localeCompare(b.name));
      // Newest star first: the registry is something you add to, so the last
      // thing filed is the one you are most likely checking on.
      default: return rows.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    }
  }, [favorites, query, sort]);

  return (
    <div className="ch-page">
      <Head><title>{t('characters.title')}</title></Head>

      <header className="ch-header">
        <h1>{t('characters.heading')}</h1>
        {/* French takes the singular at zero too, hence `<= 1` and not `=== 1`
            — an empty registry is the normal first state here. */}
        <span className="ch-count">
          {t(favorites.length <= 1 ? 'characters.countOne' : 'characters.count', { count: favorites.length })}
        </span>
      </header>

      {!loaded && <p className="ch-note">{t('characters.loading')}</p>}

      {loaded && favorites.length === 0 && (
        <div className="ch-empty">
          <p>{t('characters.empty')}</p>
          <p className="ch-note">{t('characters.emptyHint')}</p>
        </div>
      )}

      {loaded && favorites.length > 0 && (
        <>
          <div className="ch-toolbar">
            <input
              type="search"
              className="ch-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('characters.search')}
              aria-label={t('characters.search')}
            />
            <label className="ch-sort">
              {t('characters.sort')}
              <select value={sort} onChange={e => setSort(e.target.value as Sort)}>
                {SORTS.map(s => (
                  <option key={s} value={s}>{t(SORT_KEYS[s])}</option>
                ))}
              </select>
            </label>
          </div>

          {shown.length === 0 && <p className="ch-note">{t('characters.noResults')}</p>}

          <div className="ch-grid">
            {shown.map(f => (
              <article key={f.id} className="ch-card">
                <a
                  className="ch-portrait"
                  href={`https://anilist.co/character/${f.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={f.name}
                >
                  {f.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={f.image} alt={f.name} loading="lazy" />
                    : <span className="ch-fallback">{initials(f.name)}</span>}
                </a>

                <div className="ch-body">
                  <div className="ch-nameRow">
                    <span className="ch-name">{f.name}</span>
                    <button
                      type="button"
                      className="ch-unfav"
                      title={t('characters.unfavorite')}
                      aria-label={t('characters.unfavorite')}
                      onClick={() => void toggle(f)}
                    >
                      {'★'}
                    </button>
                  </div>
                  {f.nameNative && <span className="ch-native">{f.nameNative}</span>}
                  {f.role && (
                    <span className={`ch-role${f.role === 'MAIN' ? ' on' : ''}`}>
                      {f.role === 'MAIN' ? t('cast.roleMain') : f.role === 'SUPPORTING' ? t('cast.roleSupporting') : f.role}
                    </span>
                  )}

                  {/* The origin title. `animeTitle` is absent only when the
                      canonical id no longer resolves, in which case the card
                      shows the character alone rather than linking nowhere. */}
                  {f.animeTitle && (
                    <Link className="ch-anime" href={`/anime/${f.animeId}`}>{f.animeTitle}</Link>
                  )}

                  {/* The seiyuu is the genuinely predictive favourite, and this
                      is the path to starring them: /credits/seiyuu/[id] is where
                      that star lives. */}
                  {f.voiceActors.length > 0 && (
                    <span className="ch-vas">
                      {t('characters.voicedBy')}{' '}
                      {f.voiceActors.map((va, i) => (
                        <span key={va.id}>
                          {i > 0 && ', '}
                          <Link className="ch-va" href={`/credits/seiyuu/${va.id}`}>{va.name}</Link>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      <style jsx>{`
        .ch-page { padding: 1.25rem 1.5rem; color: var(--text-primary); }
        .ch-header { display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
        .ch-header h1 { margin: 0; font-size: 1.4rem; }
        .ch-count { color: var(--text-muted); font-size: 0.9rem; }
        .ch-note { color: var(--text-muted); font-size: 0.88rem; margin: 0.35rem 0; }
        .ch-empty { border: 1px dashed var(--border-color); border-radius: 10px; padding: 1.5rem; max-width: 46rem; }
        .ch-empty p { margin: 0 0 0.35rem; }

        .ch-toolbar { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 1rem; }
        .ch-search { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px;
            color: var(--text-primary); padding: 0.35rem 0.6rem; font: inherit; font-size: 0.88rem; min-width: 16rem; }
        .ch-sort { display: flex; align-items: center; gap: 0.4rem; color: var(--text-muted); font-size: 0.85rem; }
        .ch-sort select { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 6px;
            color: var(--text-primary); padding: 0.3rem 0.4rem; font: inherit; font-size: 0.85rem; }

        /* 150px tracks: wide enough for a readable portrait at the TV's ~1280
           CSS px, which fits eight across. */
        .ch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1rem; }
        .ch-card { display: flex; flex-direction: column; background: var(--bg-secondary);
            border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; }
        .ch-portrait { display: block; aspect-ratio: 3 / 4; background: var(--bg-primary); }
        .ch-portrait img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .ch-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
            color: var(--text-muted); font-size: 1.1rem; letter-spacing: 0.05em; }

        .ch-body { display: flex; flex-direction: column; gap: 2px; padding: 0.5rem 0.6rem 0.65rem; min-width: 0; }
        .ch-nameRow { display: flex; align-items: flex-start; gap: 0.35rem; }
        .ch-name { font-size: 0.86rem; line-height: 1.25; overflow-wrap: anywhere; flex: 1 1 auto; }
        .ch-unfav { flex: none; background: none; border: none; padding: 0; cursor: pointer;
            color: #f5c518; font-size: 0.95rem; line-height: 1.2; }
        .ch-unfav:hover { color: var(--text-primary); }
        .ch-native { color: var(--text-muted); font-size: 0.74rem; overflow-wrap: anywhere; }
        .ch-role { color: var(--text-muted); font-size: 0.72rem; }
        .ch-role.on { color: var(--text-secondary); }
        .ch-vas { color: var(--text-muted); font-size: 0.74rem; margin-top: 2px; overflow-wrap: anywhere; }

        /* The two classes below ride on a next/link. styled-jsx rewrites
           className on DOM elements only — a className handed to a COMPONENT
           passes through untouched — so these must be :global() and are
           hand-scoped under .ch-page. Same arrangement as /franchise/[id]. */
        .ch-page :global(.ch-anime) { color: var(--text-secondary); font-size: 0.76rem; margin-top: 3px;
            text-decoration: none; overflow-wrap: anywhere; }
        .ch-page :global(.ch-anime:hover) { color: var(--text-primary); text-decoration: underline; }
        .ch-page :global(.ch-va) { color: var(--text-secondary); text-decoration: none; }
        .ch-page :global(.ch-va:hover) { color: var(--text-primary); text-decoration: underline; }
      `}</style>
    </div>
  );
}
