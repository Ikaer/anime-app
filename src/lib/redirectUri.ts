import type { NextApiRequest } from 'next';

/**
 * OAuth redirect URIs are DERIVED from the incoming request, not configured.
 * The value the app sends in the OAuth flow must byte-match what's registered at
 * the provider — and for a self-hosted app that's always just "wherever you're
 * reaching the app" + the callback path. So there's nothing to ask the user for:
 * the same host that served the page is the host the provider must bounce back to.
 *
 * Precedence: `env var → derived-from-request`. The env var
 * (`MAL_REDIRECT_URI` / `SIMKL_REDIRECT_URI`) stays as a silent escape hatch for
 * the one case derivation can't cover — a reverse proxy that strips the
 * `X-Forwarded-*` headers we honor below. It is intentionally NOT surfaced in the
 * settings UI.
 *
 * Server-only (takes a NextApiRequest).
 */

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return undefined;
  const first = value.split(',')[0]?.trim();
  return first || undefined;
}

/**
 * Base URL of the current request, honoring a reverse proxy's `X-Forwarded-Proto`
 * / `X-Forwarded-Host` before the raw `Host` header.
 */
export function getRequestBaseUrl(req: NextApiRequest): string {
  const proto = firstHeader(req.headers['x-forwarded-proto']) || 'http';
  const host = firstHeader(req.headers['x-forwarded-host']) || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

export function getMalRedirectUri(req: NextApiRequest): string {
  return process.env.MAL_REDIRECT_URI?.trim() || `${getRequestBaseUrl(req)}/api/anime/auth`;
}

export function getSimklRedirectUri(req: NextApiRequest): string {
  return process.env.SIMKL_REDIRECT_URI?.trim() || `${getRequestBaseUrl(req)}/api/anime/simkl/auth`;
}
