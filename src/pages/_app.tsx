import { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { markNavigationStart } from '@/lib/clientPerf';
import Layout from '@/components/Layout';
import { I18nProvider } from '@/lib/i18n';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  // Stamps the click, so a probed page load (lib/clientPerf.ts) reports the wait
  // the owner felt, chunk loading included, not just its own fetch.
  useEffect(() => {
    router.events.on('routeChangeStart', markNavigationStart);
    return () => router.events.off('routeChangeStart', markNavigationStart);
  }, [router.events]);

  return (
    <I18nProvider>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </I18nProvider>
  );
}
