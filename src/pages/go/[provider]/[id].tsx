import type { GetServerSideProps } from 'next';
import { buildCrosswalkIndexes } from '@/lib/store';

/**
 * `/go/<provider>/<id>` — jump from a provider's own page to this app's record.
 *
 * The entry point for the userscript in `scripts/userscripts/`, which reads the
 * ids off a SIMKL or MAL page and links here. Resolve-only, never mints: an id
 * the registry does not anchor is a 404, not a new row.
 *
 * Extra ids may ride along as query params (`/go/simkl/41560?mal=934`) and are
 * tried when the path id misses — a SIMKL title not yet synced can still land
 * through the MAL id printed on the same page.
 *
 * ⚠️ The path provider is tried FIRST, and on SIMKL that matters: SIMKL's own id
 * is trustworthy while the MAL id it prints is a foreign key it sometimes files
 * wrong (a chibi companion's MAL id on the main show — see `simklCrosswalkFor`).
 * So the fallbacks run simkl → mal → anilist, never mal-first.
 */

const PROVIDERS = ['simkl', 'mal', 'anilist'] as const;
type Provider = typeof PROVIDERS[number];

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const provider = String(ctx.params?.provider);
  if (!isProvider(provider)) return { notFound: true };

  const indexes = buildCrosswalkIndexes();
  const byProvider: Record<Provider, Map<number, string>> = {
    simkl: indexes.bySimkl,
    mal: indexes.byMal,
    anilist: indexes.byAnilist,
  };

  const attempts: [Provider, unknown][] = [
    [provider, ctx.params?.id],
    ...PROVIDERS.filter(p => p !== provider).map((p): [Provider, unknown] => [p, ctx.query[p]]),
  ];
  for (const [p, raw] of attempts) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) continue;
    const canonicalId = byProvider[p].get(parseInt(raw, 10));
    if (canonicalId) {
      return { redirect: { destination: `/anime/${canonicalId}`, permanent: false } };
    }
  }
  return { notFound: true };
};

export default function GoRedirect() {
  return null;
}
