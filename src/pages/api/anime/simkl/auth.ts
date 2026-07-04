import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import {
  getSimklAuthData,
  saveSimklAuthData,
  clearSimklAuthData,
  isSimklTokenValid,
  saveOAuthState,
  consumeOAuthState,
  SimklAuthData,
  SimklUser,
} from '@/lib/simkl';

const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID;
const SIMKL_CLIENT_SECRET = process.env.SIMKL_CLIENT_SECRET;
const SIMKL_APP_NAME = process.env.SIMKL_APP_NAME || 'my-app-name';
const SIMKL_APP_VERSION = '1.0';
const SIMKL_REDIRECT_URI = process.env.SIMKL_REDIRECT_URI || 'http://localhost:3000/api/anime/simkl/auth';
const SIMKL_AUTH_URL = 'https://simkl.com/oauth/authorize';
const SIMKL_TOKEN_URL = 'https://api.simkl.com/oauth/token';
const SIMKL_USER_URL = 'https://api.simkl.com/users/settings';

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
    console.error('Simkl auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGetAuth(req: NextApiRequest, res: NextApiResponse) {
  const { code, state, action } = req.query;

  if (code && state) {
    await handleOAuthCallback(res, code as string, state as string);
    return;
  }

  switch (action) {
    case 'login':
      await initiateOAuthFlow(res);
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
  const { action } = req.body ?? {};
  if (action === 'logout') {
    await logout(res);
    return;
  }
  res.status(400).json({ error: 'Invalid action' });
}

async function getAuthStatus(res: NextApiResponse) {
  const { user, token } = getSimklAuthData();

  if (!user || !token || !isSimklTokenValid(token)) {
    res.json({ isAuthenticated: false, user: null });
    return;
  }

  res.json({ isAuthenticated: true, user });
}

async function initiateOAuthFlow(res: NextApiResponse) {
  if (!SIMKL_CLIENT_ID) {
    res.status(500).json({ error: 'Simkl client ID not configured' });
    return;
  }

  const state = crypto.randomUUID();
  saveOAuthState(state);

  const authUrl = new URL(SIMKL_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', SIMKL_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', SIMKL_REDIRECT_URI);
  authUrl.searchParams.set('app-name', SIMKL_APP_NAME);
  authUrl.searchParams.set('app-version', SIMKL_APP_VERSION);
  authUrl.searchParams.set('state', state);

  res.json({ authUrl: authUrl.toString() });
}

async function handleOAuthCallback(res: NextApiResponse, code: string, state: string) {
  if (!consumeOAuthState(state)) {
    res.status(400).json({ error: 'Invalid or expired state parameter' });
    return;
  }

  try {
    const tokenResponse = await fetch(SIMKL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: SIMKL_CLIENT_ID,
        client_secret: SIMKL_CLIENT_SECRET,
        redirect_uri: SIMKL_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${errorText}`);
    }

    const tokenData = (await tokenResponse.json()) as SimklAuthData;
    tokenData.created_at = Date.now();

    const userUrl = new URL(SIMKL_USER_URL);
    userUrl.searchParams.set('client_id', SIMKL_CLIENT_ID || '');
    userUrl.searchParams.set('app-name', SIMKL_APP_NAME);
    userUrl.searchParams.set('app-version', SIMKL_APP_VERSION);

    const userResponse = await fetch(userUrl.toString(), {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': `${SIMKL_APP_NAME}/${SIMKL_APP_VERSION}`,
      },
    });

    let userData: SimklUser = {};
    if (userResponse.ok) {
      userData = (await userResponse.json()) as SimklUser;
    } else {
      console.error('Simkl user info request failed:', userResponse.status, await userResponse.text());
    }

    saveSimklAuthData(userData, tokenData);

    res.redirect('/?simkl_auth=success');
  } catch (error) {
    console.error('Simkl OAuth callback error:', error);
    res.redirect('/?simkl_auth=error');
  }
}

async function logout(res: NextApiResponse) {
  clearSimklAuthData();
  res.json({ success: true });
}
