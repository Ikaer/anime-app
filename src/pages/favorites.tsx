/**
 * /favorites — « Mes seiyuu favoris ».
 *
 * One block per favourite seiyuu (`user/seiyuu_favorites.json`): who they are,
 * how much of their work you have seen, and the MAIN roles you have not — the
 * question a favourite actually asks ("what is she leading that I haven't
 * watched?"). Starring still happens on /credits/seiyuu/[id] only; this page can
 * unstar, so the list it shows is also where it is pruned.
 *
 * Reads the same `getFavSeiyuuIndex()` the rankers do, inverted per person, so a
 * title counts here exactly when it counts there: filmography ∪ cast slice,
 * resolve-only, best role per title. A favourite whose filmography has not
 * landed yet is `pending` — its numbers then cover ~your own list only, and the
 * block says so rather than looking thin.
 *
 * SSR with no API route, like /franchise/[id]: the inversion is O(index) on the
 * server and only a lean projection crosses the wire.
 */
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { getAnimeForDisplay, getAllAnilistCast, getAllAnilistSeiyuu } from '@/lib/store';
import { getFavSeiyuuIndex, getSeiyuuFavorites } from '@/lib/reco/seiyuuFavorites';
import type { SeiyuuRole } from '@/lib/reco/favSeiyuu';
import { SEEN_STATUSES } from '@/lib/reco/scoring';
import { getEffectiveStatus, getEffectiveScore, getPrimaryTitle } from '@/lib/domain/animeUtils';
import { getTitleLanguage } from '@/lib/config/settings';
import { useSeiyuuFavorites } from '@/hooks/useSeiyuuFavorites';
import { useT, type TranslationKey } from '@/lib/i18n';

/** How many unseen lead roles each block shows before linking out. */
const MAX_TODO = 10;

interface FavTitle {
  id: string;
  title: string;
  image: string | null;
  role: SeiyuuRole;
  characters: string[];
  status: string | null;
  score: number | null;
  startDate: string | null;
}

interface FavBlock {
  id: number;
  name: string;
  nameNative: string | null;
  image: string | null;
  pending: boolean;
  /** False when the stored filmography was cut at its page cap. */
  complete: boolean;
  total: number;
  seen: number;
  completed: number;
  /** Mean of your scores over their titles you rated, one decimal. */
  meanScore: number | null;
  /** Unseen MAIN roles, newest first (unaired included — announcements are the point). */
  todo: FavTitle[];
  todoTotal: number;
}

interface Props {
  blocks: FavBlock[];
}

export default function FavoritesPage({ blocks }: Props) {
  const t = useT();
  const favs = useSeiyuuFavorites();
  // Once the client store has loaded, it is the truth: an unstar here removes
  // the block at once instead of waiting for a reload.
  const shown = favs.loaded ? blocks.filter(b => favs.isFavorite(b.id)) : blocks;

  return (
    <div className="fav-page">
      <Head>
        <title>{t('favorites.pageTitle')}</title>
      </Head>

      <header className="fav-head">
        <div>
          <h1>{t('favorites.heading')}</h1>
          <p className="sub">{t('favorites.sub')}</p>
        </div>
        {shown.length > 0 && (
          <Link className="all-link" href="/?fv=1">{t('favorites.allTitles')}</Link>
        )}
      </header>

      {shown.length === 0 && <p className="empty">{t('favorites.empty')}</p>}

      {shown.map(b => (
        <section key={b.id} className="block">
          <div className="who">
            {b.image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="portrait" src={b.image} alt={b.name} loading="lazy" />
              : <span className="portrait fallback">★</span>}
            <div className="who-text">
              <Link className="name" href={`/credits/seiyuu/${b.id}`}>
                <span className="star">★</span> {b.name}
              </Link>
              {b.nameNative && <span className="native">{b.nameNative}</span>}
              <span className="stats">
                {t('favorites.counts', { total: b.total, seen: b.seen, completed: b.completed })}
                {b.meanScore !== null && <> · {t('favorites.mean', { mean: b.meanScore.toFixed(1) })}</>}
              </span>
              {b.pending && <span className="note">{t('favorites.pending')}</span>}
              {!b.pending && !b.complete && <span className="note">{t('favorites.incomplete')}</span>}
            </div>
            <button
              type="button"
              className="unfav"
              title={t('credits.unfavorite')}
              onClick={() => void favs.toggle(b.id, b.name)}
            >
              {t('credits.unfavorite')}
            </button>
          </div>

          <h3 className="todo-head">
            {t('favorites.todoHeading', { count: b.todoTotal })}
          </h3>
          {b.todo.length === 0 ? (
            <p className="empty small">{t('favorites.todoNone')}</p>
          ) : (
            <div className="row">
              {b.todo.map(a => (
                <Link key={a.id} className="card" href={`/anime/${a.id}`} title={a.characters.join(', ')}>
                  {a.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={a.image} alt={a.title} loading="lazy" />
                    : <span className="poster-fallback" />}
                  <span className="card-title">{a.title}</span>
                  <span className="card-meta">
                    {a.characters[0] ?? ''}
                    {a.startDate ? ` · ${a.startDate.slice(0, 4)}` : ''}
                  </span>
                  {a.status && (
                    <span className="card-status">{t(`statusShort.${a.status}` as TranslationKey)}</span>
                  )}
                </Link>
              ))}
              {b.todoTotal > b.todo.length && (
                <Link className="card more" href={`/credits/seiyuu/${b.id}?st=not_defined,plan_to_watch`}>
                  +{b.todoTotal - b.todo.length}
                </Link>
              )}
            </div>
          )}
        </section>
      ))}

      <style jsx>{`
        .fav-page { max-width: 1400px; margin: 0 auto; padding: 1rem 1.25rem 3rem;
          display: flex; flex-direction: column; gap: 1rem; }
        .fav-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
        h1 { margin: 0; font-size: 1.6rem; color: var(--text-primary); }
        .sub { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.85rem; }
        .empty { color: var(--text-muted); }
        .empty.small { font-size: 0.82rem; margin: 0; }

        /* Classes carried by a next/link are :global() and scoped by hand —
           styled-jsx leaves a className handed to a COMPONENT untouched. */
        .fav-page :global(.all-link) { padding: 0.35rem 0.8rem; border-radius: 999px; text-decoration: none;
          font-size: 0.82rem; background: var(--bg-secondary); border: 1px solid var(--border-color);
          color: var(--text-secondary); }
        .fav-page :global(.all-link):hover { border-color: var(--accent-primary); color: var(--text-primary); }

        .block { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px;
          padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.75rem; }
        .who { display: flex; align-items: center; gap: 1rem; }
        .portrait { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; flex: none;
          box-shadow: 0 0 0 2px #f5c518; background: var(--bg-tertiary); }
        .portrait.fallback { display: flex; align-items: center; justify-content: center; color: #f5c518; font-size: 1.6rem; }
        .who-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
        .fav-page :global(.name) { color: var(--text-primary); font-size: 1.15rem; font-weight: 600; text-decoration: none; }
        .fav-page :global(.name):hover { text-decoration: underline; }
        .star { color: #f5c518; }
        .native { color: var(--text-muted); font-size: 0.8rem; }
        .stats { color: var(--text-secondary); font-size: 0.82rem; }
        .note { color: var(--text-muted); font-size: 0.75rem; font-style: italic; }
        .unfav { flex: none; cursor: pointer; font: inherit; font-size: 0.72rem; font-weight: 600; padding: 2px 8px;
          border-radius: 999px; color: #f5c518; background: var(--bg-tertiary); border: 1px solid #f5c518; }
        .unfav:hover { color: var(--text-primary); border-color: var(--border-hover); }

        .todo-head { margin: 0; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--text-muted); font-weight: 600; }
        .row { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.75rem; }
        .row :global(.card) { display: flex; flex-direction: column; gap: 3px; text-decoration: none;
          color: var(--text-primary); min-width: 0; }
        .row :global(.card) img, .row :global(.card) .poster-fallback { width: 100%; aspect-ratio: 2 / 3;
          object-fit: cover; border-radius: 6px; background: var(--bg-tertiary); display: block; }
        .row :global(.card):hover img { outline: 2px solid var(--accent-primary); }
        .card-title { font-size: 0.78rem; line-height: 1.2; overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .card-meta { color: var(--text-muted); font-size: 0.7rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .card-status { align-self: flex-start; font-size: 0.65rem; padding: 0 6px; border-radius: 999px;
          background: var(--bg-tertiary); color: var(--text-secondary); border: 1px solid var(--border-color); }
        .row :global(.card.more) { align-items: center; justify-content: center; aspect-ratio: 2 / 3;
          border: 1px dashed var(--border-color); border-radius: 6px; color: var(--text-secondary); font-size: 1.1rem; }
        .row :global(.card.more):hover { border-color: var(--accent-primary); color: var(--text-primary); }
      `}</style>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  const favorites = getSeiyuuFavorites();
  if (favorites.length === 0) return { props: { blocks: [] } };

  const titleLang = getTitleLanguage();
  const index = getFavSeiyuuIndex();
  const pending = new Set(index.pending);
  const filmographies = getAllAnilistSeiyuu();
  const byId = new Map(getAnimeForDisplay().map(r => [r.id, r]));

  // Invert the per-title index into per-person title lists.
  const perStaff = new Map<number, { id: string; role: SeiyuuRole; characters: string[] }[]>();
  for (const [animeId, hits] of index.byAnime) {
    for (const hit of hits) {
      let list = perStaff.get(hit.staffId);
      if (!list) { list = []; perStaff.set(hit.staffId, list); }
      list.push({ id: animeId, role: hit.role, characters: hit.characters });
    }
  }

  // A pending favourite has no filmography to take a portrait from; the cast
  // slice is read only then, being the bulkiest AniList payload there is.
  let castFaces: Map<number, { image?: string; nameNative?: string }> | null = null;
  const faceFromCast = (staffId: number) => {
    if (!castFaces) {
      castFaces = new Map();
      const wanted = new Set(favorites.filter(f => !filmographies[String(f.id)]).map(f => f.id));
      for (const entry of Object.values(getAllAnilistCast())) {
        for (const ch of entry.characters) {
          for (const va of ch.voiceActors) {
            if (wanted.has(va.id) && !castFaces.has(va.id)) castFaces.set(va.id, { image: va.image, nameNative: va.nameNative });
          }
        }
      }
    }
    return castFaces.get(staffId);
  };

  const blocks: FavBlock[] = favorites.map(fav => {
    const film = filmographies[String(fav.id)];
    const face = film ?? faceFromCast(fav.id);
    const titles: FavTitle[] = [];
    for (const credit of perStaff.get(fav.id) ?? []) {
      const record = byId.get(credit.id);
      if (!record) continue;
      const score = getEffectiveScore(record);
      titles.push({
        id: record.id,
        title: getPrimaryTitle(record, titleLang),
        image: record.catalog.mainPicture?.medium ?? null,
        role: credit.role,
        characters: credit.characters,
        status: getEffectiveStatus(record) ?? null,
        score: score && score > 0 ? score : null,
        startDate: record.catalog.startDate ?? null,
      });
    }
    const scored = titles.filter(a => a.score !== null);
    const todoAll = titles
      .filter(a => a.role === 'MAIN' && !(a.status && SEEN_STATUSES.has(a.status)))
      // Undated last: an announcement with no date yet is still news, but not the newest.
      .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || a.title.localeCompare(b.title));
    return {
      id: fav.id,
      name: film?.name || fav.name,
      nameNative: face?.nameNative ?? null,
      image: face?.image ?? null,
      pending: pending.has(fav.id),
      complete: film ? film.complete : true,
      total: titles.length,
      seen: titles.filter(a => a.status && SEEN_STATUSES.has(a.status)).length,
      completed: titles.filter(a => a.status === 'completed').length,
      meanScore: scored.length ? Math.round((scored.reduce((s, a) => s + (a.score ?? 0), 0) / scored.length) * 10) / 10 : null,
      todo: todoAll.slice(0, MAX_TODO),
      todoTotal: todoAll.length,
    };
  });

  blocks.sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name));
  return { props: { blocks } };
};
