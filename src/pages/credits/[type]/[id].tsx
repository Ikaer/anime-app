import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import { listAnimeByStudio, listAnimeByStaff, type CreditedAnime } from '@/lib/creditsCatalog';
import { useT } from '@/lib/i18n';

type CreditType = 'studio' | 'staff';

interface Props {
  type: CreditType;
  name: string;
  items: CreditedAnime[];
}

export default function CreditsPage({ type, name, items }: Props) {
  const t = useT();
  const heading = type === 'studio' ? t('credits.studioHeading', { name }) : t('credits.staffHeading', { name });

  return (
    <>
      <Head>
        <title>{t('credits.pageTitle', { name })}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>

      <div className="page">
        <Link href="/" className="back">{t('detail.back')}</Link>
        <div className="head">
          <h1>{heading}</h1>
          <span className="count">{t(items.length === 1 ? 'credits.countOne' : 'credits.countOther', { count: items.length })}</span>
        </div>

        <div className="grid">
          {items.map(a => (
            <Link key={a.id} href={`/anime/${a.id}`} className="card" title={a.title}>
              {a.poster
                ? <img src={a.poster} alt="" />
                : <div className="noimg">?</div>}
              <div className="body">
                <span className="title">{a.title}</span>
                <div className="meta">
                  {a.year && <span>{a.year}</span>}
                  {a.mediaType && <span>{a.mediaType.toUpperCase()}</span>}
                  {a.mean != null && <span className="mean">★ {a.mean.toFixed(2)}</span>}
                </div>
                {a.role && <span className="role">{a.role}</span>}
              </div>
            </Link>
          ))}
        </div>
      </div>

      <style jsx>{`
        .page { max-width: 1400px; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; color: var(--text-primary); }
        .back { color: var(--accent-primary); text-decoration: none; font-weight: 600; }
        .back:hover { text-decoration: underline; }
        .head { display: flex; align-items: baseline; gap: 0.75rem; flex-wrap: wrap; margin: 1rem 0 1.5rem; }
        .head h1 { margin: 0; font-size: 1.5rem; }
        .count { color: var(--text-muted); font-size: 0.9rem; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
        .grid :global(.card) { display: flex; flex-direction: column; gap: 0.4rem; text-decoration: none;
          color: var(--text-primary); background: var(--bg-tertiary); border: 1px solid var(--border-color);
          border-radius: 10px; padding: 0.6rem; }
        .grid :global(.card):hover { border-color: var(--border-hover); }
        .grid :global(.card) img { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 6px; }
        .noimg { width: 100%; aspect-ratio: 2 / 3; border-radius: 6px; background: var(--bg-secondary);
          display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
        .body { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
        .title { font-size: 0.88rem; font-weight: 600; line-height: 1.25; overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .grid :global(.card):hover .title { text-decoration: underline; }
        .meta { display: flex; flex-wrap: wrap; gap: 0.5rem; color: var(--text-muted); font-size: 0.75rem; }
        .meta .mean { color: var(--accent-primary); }
        .role { color: var(--text-secondary); font-size: 0.75rem; }
      `}</style>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const type = String(ctx.params?.type);
  const id = parseInt(String(ctx.params?.id), 10);
  if ((type !== 'studio' && type !== 'staff') || !Number.isInteger(id)) {
    return { notFound: true };
  }
  // Catalog fields (studios/staff) only, so the personal-state cache caveat
  // doesn't apply — the shared cached catalog is fine (see similarByCredits.ts).
  const catalog = getAnimeForDisplay();
  const result = type === 'studio' ? listAnimeByStudio(id, catalog) : listAnimeByStaff(id, catalog);
  if (!result) {
    return { notFound: true };
  }
  return {
    props: {
      type,
      name: result.name,
      items: JSON.parse(JSON.stringify(result.items)),
    },
  };
};
