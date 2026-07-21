// Search-link generators for the "find this anime online" buttons.
// These build external search URLs; they do not track or store streaming providers.

const STREAMING_SITES = [
  'animationdigitalnetwork.com',
  'crunchyroll.com',
  'netflix.com',
  'primevideo.com',
  'disneyplus.com',
];

/**
 * Generate a Google "site: OR site:" query URL to find an anime across streaming sites.
 */
export function generateGoogleORQuery(animeTitle: string): string {
  const siteQueries = STREAMING_SITES.map(site => `site:${site}`).join(' OR ');
  const searchQuery = `(${siteQueries}) "${animeTitle}"`;
  return `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=fr&gl=fr`;
}

/**
 * Generate a JustWatch search URL for an anime.
 * The `providers` query param uses JustWatch's own filter codes
 * (adn, cru = Crunchyroll, dnp = Disney+, nfx = Netflix, prv = Prime Video).
 */
export function generateJustWatchQuery(animeTitle: string): string {
  const searchQuery = animeTitle.trim();
  const justWatchProviderCodes = 'adn,cru,dnp,nfx,prv';
  return `https://www.justwatch.com/fr/recherche?providers=${justWatchProviderCodes}&q=${encodeURIComponent(searchQuery)}`;
}
