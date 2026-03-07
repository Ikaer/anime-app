export interface StreamingProvider {
  id: number;
  name: string;
  logo: string;
  url: string;
  urlPatterns: string[];
  priority: number;
}

export const STREAMING_PROVIDERS: StreamingProvider[] = [
  {
    id: 1,
    name: "ADN",
    logo: "adn.png",
    url: "https://animationdigitalnetwork.com",
    urlPatterns: ["animationdigitalnetwork.com", "www.animationdigitalnetwork.com", "adn.app"],
    priority: 1
  },
  {
    id: 2,
    name: "Crunchyroll",
    logo: "crunchyroll.svg",
    url: "https://www.crunchyroll.com",
    urlPatterns: ["crunchyroll.com", "www.crunchyroll.com"],
    priority: 2
  },
  {
    id: 3,
    name: "Netflix",
    logo: "netflix.png",
    url: "https://www.netflix.com",
    urlPatterns: ["netflix.com", "www.netflix.com"],
    priority: 3
  },
  {
    id: 4,
    name: "Prime",
    logo: "prime.svg",
    url: "https://www.primevideo.com",
    urlPatterns: ["primevideo.com", "www.primevideo.com", "amazon.com/prime", "amazon.fr/prime"],
    priority: 4
  },
  {
    id: 5,
    name: "Disney",
    logo: "disney.png",
    url: "https://www.disneyplus.com",
    urlPatterns: ["disneyplus.com", "www.disneyplus.com"],
    priority: 5
  }
];

/**
 * Detect streaming provider from URL
 */
export function detectProviderFromUrl(url: string): StreamingProvider | null {
  if (!url) return null;
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    const fullPath = `${hostname}${urlObj.pathname}`.toLowerCase();
    
    for (const provider of STREAMING_PROVIDERS) {
      for (const pattern of provider.urlPatterns) {
        if (hostname.includes(pattern.toLowerCase()) || fullPath.includes(pattern.toLowerCase())) {
          return provider;
        }
      }
    }
  } catch (error) {
    // Invalid URL
    return null;
  }
  
  return null;
}

/**
 * Get provider logo path for use in img src
 */
export function getProviderLogoPath(provider: StreamingProvider): string {
  return `/providers/${provider.logo}`;
}

/**
 * Get provider by name (case insensitive)
 */
export function getProviderByName(name: string): StreamingProvider | null {
  const normalizedName = name.toLowerCase().trim();
  return STREAMING_PROVIDERS.find(p => p.name.toLowerCase() === normalizedName) || null;
}

/**
 * Get all available providers
 */
export function getAllProviders(): StreamingProvider[] {
  return [...STREAMING_PROVIDERS];
}

/**
 * Format provider for display in forms/dropdowns
 */
export function formatProviderOption(provider: StreamingProvider): { value: string; label: string; logo: string } {
  return {
    value: provider.name,
    label: provider.name,
    logo: getProviderLogoPath(provider)
  };
}

/**
 * Generate Google OR query URL for anime provider search
 */
export function generateGoogleORQuery(animeTitle: string, providers = STREAMING_PROVIDERS): string {
  const siteQueries = providers.map(provider => `site:${getProviderSite(provider.name)}`).join(' OR ');
  const searchQuery = `(${siteQueries}) "${animeTitle}"`;
  return `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&hl=fr&gl=fr`;
}

/**
 * Get provider site domain for Google search
 */
function getProviderSite(providerName: string): string {
  const sites: Record<string, string> = {
    'ADN': 'animationdigitalnetwork.com',
    'Crunchyroll': 'crunchyroll.com',
    'Netflix': 'netflix.com',
    'Prime': 'primevideo.com',
    'Disney': 'disneyplus.com'
  };
  return sites[providerName] || '';
}

/**
 * Parse search results and categorize by provider
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  provider: string;
  priority: number;
  detected: boolean;
}

export function categorizeSearchResults(results: Array<{title: string; url: string; snippet?: string}>): SearchResult[] {
  return results.map(result => {
    const provider = detectProviderFromUrl(result.url);
    return {
      ...result,
      provider: provider?.name || 'Unknown',
      priority: provider?.priority || 999,
      detected: !!provider
    };
  }).filter(result => result.detected)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get provider priority for sorting
 */
export function getProviderPriority(providerName: string): number {
  const provider = STREAMING_PROVIDERS.find(p => p.name === providerName);
  return provider ? provider.priority : 999;
}

/**
 * Generate JustWatch search URL for anime
 */
export function generateJustWatchQuery(animeTitle: string): string {
  // JustWatch uses "recherche" and includes provider filters
  // Provider codes: adn, cru (Crunchyroll), dnp (Disney+), nfx (Netflix), prv (Prime Video)
  const searchQuery = animeTitle.trim();
  const providers = "adn,cru,dnp,nfx,prv"; // Main streaming providers
  return `https://www.justwatch.com/fr/recherche?providers=${providers}&q=${encodeURIComponent(searchQuery)}`;
}
