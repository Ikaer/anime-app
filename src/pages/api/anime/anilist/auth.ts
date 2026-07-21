/**
 * AniList OAuth endpoint — `login` / `status` / `logout` plus the registered
 * redirect-URI callback, mirroring `simkl/auth.ts`. See `@/lib/anilistAuth` for
 * why the state check here is tolerant rather than a hard reject.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { appendLog } from '@/lib/connectionLog';
import {
  getAnilistAuthData,
  saveAnilistAuthData,
  clearAnilistAuthData,
  isAnilistTokenValid,
  saveOAuthState,
  consumeOAuthState,
  fetchAnilistViewer,
  ANILIST_AUTHORIZE_URL,
  ANILIST_TOKEN_URL,
  AniListAuthData,
} from '@/lib/providers/anilist/auth';
import { getAnilistClientId, getAnilistClientSecret } from '@/lib/settings';
import { getAnilistRedirectUri } from '@/lib/redirectUri';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        await handleGetAuth(req, res);
        break;
      case 'POST':
        await handlePostAuth(req, res);
        break;
      default:
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
  } catch (error) {
    console.error('AniList auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGetAuth(req: NextApiRequest, res: NextApiResponse) {
  const { code, state, action } = req.query;

  // AniList sends only `code` back (state is not documented as round-tripped),
  // so the callback is detected on `code` alone — requiring `state` here would
  // make every login fall through to the status branch.
  if (code) {
    await handleOAuthCallback(req, res, code as string, typeof state === 'string' ? state : undefined);
    return;
  }

  switch (action) {
    case 'login':
      await initiateOAuthFlow(req, res);
      break;
    case 'logout':
      await logout(res);
      break;
    case 'status':
    default:
      await getAuthStatus(res);
  }
}

async function handlePostAuth(req: NextApiRequest, res: NextApiResponse) {
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  if (body?.action === 'logout') {
    await logout(res);
    return;
  }
  res.status(400).json({ error: 'Invalid action' });
}

function safeParse(raw: string): { action?: string } | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function getAuthStatus(res: NextApiResponse) {
  const { user, token } = getAnilistAuthData();
  if (!user || !token || !isAnilistTokenValid(token)) {
    res.json({ isAuthenticated: false, user: null, isConfigured: !!getAnilistClientId() });
    return;
  }
  res.json({ isAuthenticated: true, user, isConfigured: true });
}

async function initiateOAuthFlow(req: NextApiRequest, res: NextApiResponse) {
  const clientId = getAnilistClientId();
  if (!clientId) {
    res.status(500).json({ error: 'AniList client ID not configured' });
    return;
  }

  const state = crypto.randomUUID();
  saveOAuthState(state);

  const authUrl = new URL(ANILIST_AUTHORIZE_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', getAnilistRedirectUri(req));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);

  appendLog('anilist-auth', 'info', 'AniList login initiated', { redirectUri: getAnilistRedirectUri(req) });
  res.json({ authUrl: authUrl.toString() });
}

async function handleOAuthCallback(
  req: NextApiRequest,
  res: NextApiResponse,
  code: string,
  state: string | undefined
) {
  // Tolerant by design: AniList is not documented to echo `state`. Reject only a
  // state that came back and is stale/forged; accept an absent one.
  if (state !== undefined && !consumeOAuthState(state)) {
    appendLog('anilist-auth', 'error', 'AniList OAuth callback failed: invalid or expired state');
    res.redirect('/connections?anilist_auth=error');
    return;
  }

  try {
    const clientSecret = getAnilistClientSecret();
    if (!clientSecret) throw new Error('AniList client secret not configured');

    const tokenResponse = await fetch(ANILIST_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: getAnilistClientId(),
        client_secret: clientSecret,
        redirect_uri: getAnilistRedirectUri(req),
        code,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText.slice(0, 300)}`);
    }

    const tokenData = (await tokenResponse.json()) as AniListAuthData;
    if (!tokenData.access_token) throw new Error('Token exchange returned no access_token');
    tokenData.created_at = Date.now();

    // Identify the token holder. Non-fatal: a token that works for writes but
    // whose Viewer lookup hiccuped shouldn't discard a successful login.
    let viewer = null;
    try {
      viewer = await fetchAnilistViewer(tokenData.access_token);
    } catch (e) {
      console.error('AniList viewer lookup failed:', e);
    }

    saveAnilistAuthData(viewer, tokenData);
    appendLog('anilist-auth', 'success', `AniList OAuth callback succeeded for user ${viewer?.name ?? 'unknown'}`, {
      user: viewer?.name,
      scoreFormat: viewer?.scoreFormat,
    });

    res.redirect('/connections?anilist_auth=success');
  } catch (error) {
    console.error('AniList OAuth callback error:', error);
    appendLog('anilist-auth', 'error', 'AniList OAuth callback failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.redirect('/connections?anilist_auth=error');
  }
}

async function logout(res: NextApiResponse) {
  clearAnilistAuthData();
  appendLog('anilist-auth', 'info', 'AniList account disconnected');
  res.json({ success: true });
}
