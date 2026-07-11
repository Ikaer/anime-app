import { AppProps } from 'next/app';
import Layout from '@/components/Layout';
import { I18nProvider } from '@/lib/i18n';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <I18nProvider>
      <Layout>
        <Component {...pageProps} />
      </Layout>
    </I18nProvider>
  );
}
