import Head from 'next/head';
import dynamic from 'next/dynamic';

const AnimeRatingCalculator = dynamic(
  () => import('@/components/calculator/AnimeRatingCalculator'),
  { ssr: false }
);

export default function RatePage() {
  return (
    <>
      <Head>
        <title>Anime Rating Calculator</title>
      </Head>
      <AnimeRatingCalculator />
    </>
  );
}
