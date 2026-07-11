import Head from 'next/head';
import dynamic from 'next/dynamic';
import { useT } from '@/lib/i18n';

const AnimeRatingCalculator = dynamic(
  () => import('@/components/calculator/AnimeRatingCalculator'),
  { ssr: false }
);

export default function RatePage() {
  const t = useT();
  return (
    <>
      <Head>
        <title>{t('calc.pageTitle')}</title>
      </Head>
      <AnimeRatingCalculator />
    </>
  );
}
