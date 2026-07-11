import Head from 'next/head';
import dynamic from 'next/dynamic';
import type { GetServerSideProps } from 'next';
import { getAnimeByIdForDisplay } from '@/lib/store';
import { getPrimaryTitle } from '@/lib/animeUtils';
import type { RatingTarget } from '@/lib/ratingGrids';
import { useT } from '@/lib/i18n';

const AnimeRatingCalculator = dynamic(
  () => import('@/components/calculator/AnimeRatingCalculator'),
  { ssr: false }
);
const AnimeRatePicker = dynamic(
  () => import('@/components/calculator/AnimeRatePicker'),
  { ssr: false }
);

interface Props {
  anime: RatingTarget | null;
}

export default function RatePage({ anime }: Props) {
  const t = useT();
  return (
    <>
      <Head>
        <title>{t('calc.pageTitle')}</title>
      </Head>
      {anime ? <AnimeRatingCalculator anime={anime} /> : <AnimeRatePicker />}
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const idParam = ctx.query.id;
  const id = typeof idParam === 'string' ? parseInt(idParam, 10) : NaN;
  if (!Number.isInteger(id)) {
    return { props: { anime: null } };
  }
  // getAnimeByIdForDisplay assembles straight from the files (cache-bypassing),
  // same pattern as the detail page — required after an API-route mutation.
  const anime = getAnimeByIdForDisplay(id);
  if (!anime) {
    return { props: { anime: null } };
  }
  const target: RatingTarget = {
    id: anime.id,
    title: getPrimaryTitle(anime),
    genres: (anime.genres || []).map(g => ({ id: g.id, name: g.name })),
    poster: anime.main_picture?.large || anime.main_picture?.medium || null,
  };
  return { props: { anime: target } };
};
