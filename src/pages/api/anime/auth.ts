import { NextApiRequest, NextApiResponse } from 'next';
import { getMALAuthData, saveMALAuthData, clearMALAuthData, isMALTokenValid } from '@/lib/mal';
import { MALAuthData, MALUser } from '@/models/anime';
import { appendLog } from '@/lib/connectionLog';
import crypto from 'crypto';
import fs from 'fs';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/jsonStore';

// MAL OAuth2 configuration
const MAL_CLIENT_ID = process.env.MAL_CLIENT_ID;
const MAL_REDIRECT_URI = process.env.MAL_REDIRECT_URI || 'http://localhost:3000/api/anime/auth';
const MAL_AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize';
const MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';

// PKCE helper functions
function generateCodeVerifier(): string {
  // Generate a code verifier that's at least 43 characters (MAL requirement)
  let codeVerifier = crypto.randomBytes(32).toString('base64url');
  while (codeVerifier.length < 43) {
    codeVerifier += 'A';
  }
  return codeVerifier;
}

// For MAL, we use 'plain' method, so code_challenge = code_verifier
function generateCodeChallenge(verifier: string): string {
  return verifier; // MAL uses 'plain' method, not S256
}

// Store code verifier in file system for persistence across server restarts
const CODE_VERIFIER_FILE = dataFile('oauth_state.json');
const STATE_TTL_MS = 10 * 60 * 1000;

type VerifierStore = Record<string, { verifier: string; timestamp: number }>;

function readVerifierStore(): VerifierStore {
  return readJsonFile<VerifierStore>(CODE_VERIFIER_FILE, {});
}

function saveCodeVerifier(state: string, verifier: string): void {
  try {
    const stateData = readVerifierStore();

    const now = Date.now();
    Object.keys(stateData).forEach(key => {
      if (now - stateData[key].timestamp > STATE_TTL_MS) {
        delete stateData[key];
      }
    });

    stateData[state] = { verifier, timestamp: now };
    writeJsonFile(CODE_VERIFIER_FILE, stateData);
  } catch (error) {
    console.error('Error saving code verifier:', error);
  }
}

function getCodeVerifier(state: string): string | null {
  const stateData = readVerifierStore();
  const entry = stateData[state];
  if (!entry) return null;

  if (Date.now() - entry.timestamp > STATE_TTL_MS) {
    deleteCodeVerifier(state);
    return null;
  }

  return entry.verifier;
}

function deleteCodeVerifier(state: string): void {
  try {
    const stateData = readVerifierStore();
    delete stateData[state];
    writeJsonFile(CODE_VERIFIER_FILE, stateData);
  } catch (error) {
    console.error('Error deleting code verifier:', error);
  }
}

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
    console.error('MAL Auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleGetAuth(req: NextApiRequest, res: NextApiResponse) {
  const { code, state, action } = req.query;

  // Handle OAuth callback
  if (code && state) {
    await handleOAuthCallback(req, res, code as string, state as string);
    return;
  }

  // Handle different actions
  switch (action) {
    case 'status':
      await getAuthStatus(req, res);
      break;
    case 'login':
      await initiateOAuthFlow(req, res);
      break;
    case 'logout':
      await logout(req, res);
      break;
    case 'clear':
      await clearOAuthState(req, res);
      break;
    default:
      await getAuthStatus(req, res);
  }
}

async function handlePostAuth(req: NextApiRequest, res: NextApiResponse) {
  const { action } = req.body;

  switch (action) {
    case 'logout':
      await logout(req, res);
      break;
    default:
      res.status(400).json({ error: 'Invalid action' });
  }
}

async function getAuthStatus(req: NextApiRequest, res: NextApiResponse) {
  const { user, token } = getMALAuthData();
  
  if (!user || !token || !isMALTokenValid(token)) {
    res.json({
      isAuthenticated: false,
      user: null
    });
    return;
  }

  res.json({
    isAuthenticated: true,
    user
  });
}

async function initiateOAuthFlow(req: NextApiRequest, res: NextApiResponse) {
  if (!MAL_CLIENT_ID) {
    res.status(500).json({ error: 'MAL client ID not configured' });
    return;
  }

  console.log('Initiating OAuth flow with client ID:', MAL_CLIENT_ID);
  console.log('Redirect URI:', MAL_REDIRECT_URI);

  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  console.log('Generated state:', state);
  console.log('Generated code challenge:', codeChallenge);

  // Store code verifier with state as key
  saveCodeVerifier(state, codeVerifier);

  const authUrl = new URL(MAL_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', MAL_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', MAL_REDIRECT_URI);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'plain'); // MAL uses 'plain', not 'S256'

  console.log('Generated auth URL:', authUrl.toString());

  appendLog('mal-auth', 'info', 'MAL login initiated');

  res.json({ authUrl: authUrl.toString() });
}

async function handleOAuthCallback(req: NextApiRequest, res: NextApiResponse, code: string, state: string) {
  console.log('Handling OAuth callback with state:', state);
  
  const codeVerifier = getCodeVerifier(state);
  if (!codeVerifier) {
    console.error('Invalid or expired state parameter:', state);
    appendLog('mal-auth', 'error', 'MAL OAuth callback failed: invalid or expired state');
    res.status(400).json({ error: 'Invalid or expired state parameter' });
    return;
  }

  // Clean up stored verifier
  deleteCodeVerifier(state);

  try {
    console.log('Exchanging code for token...');
    
    // Exchange code for token
    const tokenResponse = await fetch(MAL_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: MAL_CLIENT_ID!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: MAL_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
    }

    const tokenData: MALAuthData = await tokenResponse.json();
    tokenData.created_at = Date.now();
    
    console.log('Token exchange successful');

    // Get user info
    const userResponse = await fetch('https://api.myanimelist.net/v2/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    if (!userResponse.ok) {
      const errorText = await userResponse.text();
      console.error('User info request failed:', userResponse.status, errorText);
      throw new Error(`User info request failed: ${userResponse.status} ${userResponse.statusText}`);
    }

    const userData: MALUser = await userResponse.json();
    
    console.log('User info retrieved:', userData.name);

    // Save auth data
    saveMALAuthData(userData, tokenData);

    appendLog('mal-auth', 'success', `MAL OAuth callback succeeded for user ${userData.name}`, {
      user: userData.name,
    });

    // Redirect to anime page
    res.redirect('/?auth=success');
  } catch (error) {
    console.error('OAuth callback error:', error);
    appendLog('mal-auth', 'error', 'MAL OAuth callback failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.redirect('/?auth=error');
  }
}

async function logout(req: NextApiRequest, res: NextApiResponse) {
  clearMALAuthData();
  appendLog('mal-auth', 'info', 'MAL account disconnected');
  res.json({ success: true });
}

async function clearOAuthState(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (fs.existsSync(CODE_VERIFIER_FILE)) {
      fs.unlinkSync(CODE_VERIFIER_FILE);
    }
    res.json({ success: true, message: 'OAuth state cleared' });
  } catch (error) {
    console.error('Error clearing OAuth state:', error);
    res.status(500).json({ error: 'Failed to clear OAuth state' });
  }
}
