import { AppProps } from 'next/app';
import Head from 'next/head';
import Layout from '@/components/Layout';
import { I18nProvider } from '@/lib/i18n';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
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
