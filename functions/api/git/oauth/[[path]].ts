import {
  PagesContext,
  handleCorsPreflight,
  jsonEdgeResponse,
  fetchWithTimeout,
  timingSafeEqualStrings,
  validateEdgeGitLabHost,
} from '../../../_lib/edgeHelpers';

const OAUTH_STATE_COOKIE = 'supremeai_git_oauth_state';

function generateHexNonce(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(header: string | null, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return '';
}

function buildStateCookie(value: string, maxAgeSec: number, isHttps: boolean): string {
  return `${OAUTH_STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/git/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isHttps ? '; Secure' : ''}`;
}

function buildPopupHtml(
  payload: Record<string, unknown>,
  targetOrigin: string,
  clearCookieHeader?: string
): Response {
  const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const safeOrigin = JSON.stringify(targetOrigin).replace(/</g, '\\u003c');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>SupremeAI Git OAuth</title></head><body style="background:#090d16;color:#e2e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="text-align:center;max-width:380px;padding:24px;"><p>Completing authorization...</p></div><script>try{if(window.opener){window.opener.postMessage(${safeJson}, ${safeOrigin});}}catch(e){}setTimeout(function(){window.close();},350);</script></body></html>`;
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  if (clearCookieHeader) {
    headers.set('Set-Cookie', clearCookieHeader);
  }
  return new Response(html, {
    status: 200,
    headers,
  });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);

  const incomingUrl = new URL(request.url);
  const path = incomingUrl.pathname;
  const origin = incomingUrl.origin;
  const isHttps = incomingUrl.protocol === 'https:';

  const githubClientId = (env?.GITHUB_CLIENT_ID || env?.GITHUB_OAUTH_CLIENT_ID || '').trim();
  const githubClientSecret = (
    env?.GITHUB_CLIENT_SECRET ||
    env?.GITHUB_OAUTH_CLIENT_SECRET ||
    ''
  ).trim();
  const gitlabClientId = (env?.GITLAB_CLIENT_ID || env?.GITLAB_OAUTH_CLIENT_ID || '').trim();
  const gitlabClientSecret = (
    env?.GITLAB_CLIENT_SECRET ||
    env?.GITLAB_OAUTH_CLIENT_SECRET ||
    ''
  ).trim();

  const githubCallbackUrl = `${origin}/api/git/oauth/github/callback`;
  const gitlabCallbackUrl = `${origin}/api/git/oauth/gitlab/callback`;

  if (path === '/api/git/oauth/status') {
    return jsonEdgeResponse(
      {
        githubConfigured: Boolean(githubClientId && githubClientSecret),
        gitlabConfigured: Boolean(gitlabClientId && gitlabClientSecret),
        githubCallbackUrl,
        gitlabCallbackUrl,
      },
      200,
      request,
      undefined,
      env
    );
  }

  if (path === '/api/git/oauth/github/url') {
    if (!githubClientId || !githubClientSecret) {
      return jsonEdgeResponse(
        {
          configured: false,
          callbackUrl: githubCallbackUrl,
          error:
            'GitHub OAuth credentials are not configured on Cloudflare Pages env. Use a GitHub Personal Access Token directly.',
        },
        400,
        request,
        undefined,
        env
      );
    }
    const state = generateHexNonce(16);
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      githubClientId
    )}&redirect_uri=${encodeURIComponent(githubCallbackUrl)}&scope=repo&state=${encodeURIComponent(
      state
    )}`;
    return jsonEdgeResponse(
      { configured: true, url: authUrl, callbackUrl: githubCallbackUrl },
      200,
      request,
      {
        'Set-Cookie': buildStateCookie(`github:${state}`, 600, isHttps),
      },
      env
    );
  }

  if (path === '/api/git/oauth/gitlab/url') {
    const hostCheck = validateEdgeGitLabHost(
      incomingUrl.searchParams.get('host'),
      env?.GITLAB_HOST
    );
    if (!hostCheck.valid || !('origin' in hostCheck)) {
      return jsonEdgeResponse(
        { error: 'reason' in hostCheck ? hostCheck.reason : 'Untrusted GitLab host.' },
        400,
        request,
        undefined,
        env
      );
    }
    const host = hostCheck.origin;
    if (!gitlabClientId || !gitlabClientSecret) {
      return jsonEdgeResponse(
        {
          configured: false,
          callbackUrl: gitlabCallbackUrl,
          error:
            'GitLab OAuth credentials are not configured on Cloudflare Pages env. Use a GitLab Personal Access Token directly.',
        },
        400,
        request,
        undefined,
        env
      );
    }
    const state = generateHexNonce(16);
    const authUrl = `${host}/oauth/authorize?client_id=${encodeURIComponent(
      gitlabClientId
    )}&redirect_uri=${encodeURIComponent(
      gitlabCallbackUrl
    )}&response_type=code&scope=api&state=${encodeURIComponent(state)}`;
    return jsonEdgeResponse(
      { configured: true, url: authUrl, callbackUrl: gitlabCallbackUrl },
      200,
      request,
      {
        'Set-Cookie': buildStateCookie(`gitlab:${state}:${host}`, 600, isHttps),
      },
      env
    );
  }

  if (path.startsWith('/api/git/oauth/github/callback')) {
    const clearCookie = buildStateCookie('', 0, isHttps);
    const code = (incomingUrl.searchParams.get('code') || '').trim();
    const state = (incomingUrl.searchParams.get('state') || '').trim();
    const expectedCookie = readCookie(request.headers.get('Cookie'), OAUTH_STATE_COOKIE);
    const expectedState = expectedCookie.startsWith('github:') ? expectedCookie.slice(7) : '';

    if (!code || !state || !expectedState || !timingSafeEqualStrings(state, expectedState)) {
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'github',
          error: 'Invalid or expired OAuth state parameter.',
        },
        origin,
        clearCookie
      );
    }
    if (!githubClientId || !githubClientSecret) {
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'github',
          error: 'Missing OAuth server credentials.',
        },
        origin,
        clearCookie
      );
    }
    try {
      const tokenRes = await fetchWithTimeout('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: githubClientId,
          client_secret: githubClientSecret,
          code,
          redirect_uri: githubCallbackUrl,
        }),
      });
      const tokenJson = (await tokenRes.json().catch(() => null)) as {
        access_token?: string;
        error_description?: string;
        error?: string;
      } | null;
      if (tokenJson?.access_token) {
        return buildPopupHtml(
          {
            type: 'SUPREMEAI_GIT_OAUTH_SUCCESS',
            provider: 'github',
            token: tokenJson.access_token,
          },
          origin,
          clearCookie
        );
      }
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'github',
          error: tokenJson?.error_description || 'Token exchange failed.',
        },
        origin,
        clearCookie
      );
    } catch {
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'github',
          error: 'GitHub OAuth exchange timed out.',
        },
        origin,
        clearCookie
      );
    }
  }

  if (path.startsWith('/api/git/oauth/gitlab/callback')) {
    const clearCookie = buildStateCookie('', 0, isHttps);
    const code = (incomingUrl.searchParams.get('code') || '').trim();
    const state = (incomingUrl.searchParams.get('state') || '').trim();
    const expectedCookie = readCookie(request.headers.get('Cookie'), OAUTH_STATE_COOKIE);
    const cookieRest = expectedCookie.startsWith('gitlab:') ? expectedCookie.slice(7) : '';
    const colonIdx = cookieRest.indexOf(':');
    const expectedState = colonIdx >= 0 ? cookieRest.slice(0, colonIdx) : cookieRest;
    const cookieHost = colonIdx >= 0 ? cookieRest.slice(colonIdx + 1) : '';

    if (!code || !state || !expectedState || !timingSafeEqualStrings(state, expectedState)) {
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'gitlab',
          error: 'Invalid or expired OAuth state parameter.',
        },
        origin,
        clearCookie
      );
    }

    const hostCheck = validateEdgeGitLabHost(cookieHost, env?.GITLAB_HOST);
    if (!hostCheck.valid || !('origin' in hostCheck)) {
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'gitlab',
          error: 'reason' in hostCheck ? hostCheck.reason : 'Untrusted GitLab host.',
        },
        origin,
        clearCookie
      );
    }
    const host = hostCheck.origin;

    if (!gitlabClientId || !gitlabClientSecret) {
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'gitlab',
          error: 'Missing OAuth server credentials.',
        },
        origin,
        clearCookie
      );
    }
    try {
      const tokenRes = await fetchWithTimeout(`${host}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: gitlabClientId,
          client_secret: gitlabClientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: gitlabCallbackUrl,
        }),
      });
      const tokenJson = (await tokenRes.json().catch(() => null)) as {
        access_token?: string;
        error_description?: string;
        error?: string;
      } | null;
      if (tokenJson?.access_token) {
        return buildPopupHtml(
          {
            type: 'SUPREMEAI_GIT_OAUTH_SUCCESS',
            provider: 'gitlab',
            token: tokenJson.access_token,
            host,
          },
          origin,
          clearCookie
        );
      }
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'gitlab',
          error: tokenJson?.error_description || 'GitLab token exchange failed.',
        },
        origin,
        clearCookie
      );
    } catch {
      return buildPopupHtml(
        {
          type: 'SUPREMEAI_GIT_OAUTH_ERROR',
          provider: 'gitlab',
          error: 'GitLab OAuth exchange timed out.',
        },
        origin,
        clearCookie
      );
    }
  }

  return jsonEdgeResponse({ error: 'Unknown Git OAuth route' }, 404, request, undefined, env);
}
