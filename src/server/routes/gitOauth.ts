import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { validateGitLabHost } from '../../shared/serverSecurity';
import { routeRateLimit } from '../routeRateLimit';

/**
 * Git OAuth — `GET /api/git/oauth/*` (status, url, callback)
 *
 * WHY THIS FILE EXISTS
 *   GitHub/GitLab OAuth popup flow (3 handlers + state store + base-url
 *   helper) lived inline in `server.ts` (~220 lines). Cohesive (single
 *   state map, single callback renderer, shared host validation) and has no
 *   other consumer. Moving it keeps the monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `oauthStateStore`, `resolveAppBaseUrl` and 3 route handlers are OWNED
 *     here (no other route reads OAuth state).
 *   - `PORT` injected via ctx for fallback origin (closure over server port).
 *   - `validateGitLabHost` imported directly (pure function).
 */

export interface GitOauthContext {
  PORT: number;
}

const MAX_OAUTH_STATES = 1000;
const SAFE_HOST_PATTERN = /^(?:\[[a-fA-F0-9:]+\]|[a-zA-Z0-9.-]+)(?::\d{1,5})?$/;

export function registerGitOauthRoutes(app: Express, ctx: GitOauthContext): void {
  const oauthRateLimit = routeRateLimit(60);
  const oauthStateStore = new Map<
    string,
    { provider: 'github' | 'gitlab'; host?: string; expiresAt: number }
  >();

  // বাংলা মন্তব্য: মেমরি নিঃশেষ (OOM) রোধে মেয়াদোত্তীর্ণ ও অতিরিক্ত OAuth state ছাঁটাই করা হচ্ছে
  const recordOAuthState = (
    state: string,
    entry: { provider: 'github' | 'gitlab'; host?: string; expiresAt: number }
  ) => {
    const now = Date.now();
    if (oauthStateStore.size >= MAX_OAUTH_STATES) {
      for (const [k, v] of oauthStateStore) {
        if (v.expiresAt <= now) oauthStateStore.delete(k);
      }
      while (oauthStateStore.size >= MAX_OAUTH_STATES) {
        const oldestKey = oauthStateStore.keys().next().value;
        if (!oldestKey) break;
        oauthStateStore.delete(oldestKey);
      }
    }
    oauthStateStore.set(state, entry);
  };

  // বাংলা মন্তব্য: হেডার ইনজেকশন বা ক্ষতিকর প্রোটোকল (javascript:/data:) প্রতিরোধে কঠোর http/https ও host যাচাই
  const resolveAppBaseUrl = (req: Request): string => {
    const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
    if (configured) {
      try {
        const parsed = new URL(configured);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.origin;
        }
      } catch {
        // Fall through to validated request host
      }
    }
    const rawProto = String(req.header('x-forwarded-proto') || req.protocol || 'http')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto = rawProto === 'https' ? 'https' : 'http';
    const rawHost = String(req.header('x-forwarded-host') || req.header('host') || '')
      .split(',')[0]
      .trim();
    const host = SAFE_HOST_PATTERN.test(rawHost) ? rawHost : `127.0.0.1:${ctx.PORT}`;
    return `${proto}://${host}`;
  };

  app.get('/api/git/oauth/status', oauthRateLimit, (req: Request, res: Response) => {
    const baseUrl = resolveAppBaseUrl(req);
    res.json({
      githubConfigured: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      gitlabConfigured: Boolean(process.env.GITLAB_CLIENT_ID && process.env.GITLAB_CLIENT_SECRET),
      githubCallbackUrl: `${baseUrl}/api/git/oauth/github/callback`,
      gitlabCallbackUrl: `${baseUrl}/api/git/oauth/gitlab/callback`,
    });
  });

  app.get('/api/git/oauth/:provider/url', oauthRateLimit, (req: Request, res: Response) => {
    const provider =
      req.params.provider === 'gitlab'
        ? 'gitlab'
        : req.params.provider === 'github'
          ? 'github'
          : null;
    if (!provider) {
      res.status(400).json({ error: 'Unsupported OAuth provider.' });
      return;
    }
    const baseUrl = resolveAppBaseUrl(req);
    const callbackUrl = `${baseUrl}/api/git/oauth/${provider}/callback`;
    const state = crypto.randomBytes(16).toString('hex');

    if (provider === 'github') {
      const clientId = (process.env.GITHUB_CLIENT_ID || '').trim();
      if (!clientId || !(process.env.GITHUB_CLIENT_SECRET || '').trim()) {
        res.status(501).json({
          configured: false,
          provider,
          callbackUrl,
          error: `GitHub OAuth is not configured on this server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET with callback URL ${callbackUrl} (or use a Personal Access Token).`,
        });
        return;
      }
      recordOAuthState(state, { provider: 'github', expiresAt: Date.now() + 10 * 60 * 1000 });
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'repo read:user',
        state,
      });
      res.json({
        configured: true,
        url: `https://github.com/login/oauth/authorize?${params}`,
        callbackUrl,
      });
      return;
    }

    const hostValidation = validateGitLabHost(
      String(req.query.host || ''),
      process.env.GITLAB_HOST
    );
    if (!hostValidation.ok || !('host' in hostValidation)) {
      res.status(400).json({
        error: 'error' in hostValidation ? hostValidation.error : 'Invalid GitLab host.',
      });
      return;
    }
    const gitlabHost = hostValidation.host;
    const clientId = (process.env.GITLAB_CLIENT_ID || '').trim();
    if (!clientId || !(process.env.GITLAB_CLIENT_SECRET || '').trim()) {
      res.status(501).json({
        configured: false,
        provider,
        callbackUrl,
        error: `GitLab OAuth is not configured on this server. Set GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET with callback URL ${callbackUrl} (or use a Personal Access Token).`,
      });
      return;
    }
    recordOAuthState(state, {
      provider: 'gitlab',
      host: gitlabHost,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'api read_user',
      state,
    });
    res.json({ configured: true, url: `${gitlabHost}/oauth/authorize?${params}`, callbackUrl });
  });

  app.get(
    ['/api/git/oauth/:provider/callback', '/api/git/oauth/:provider/callback/'],
    oauthRateLimit,
    async (req: Request, res: Response) => {
      const provider =
        req.params.provider === 'gitlab'
          ? 'gitlab'
          : req.params.provider === 'github'
            ? 'github'
            : null;
      const code = String(req.query.code || '').trim();
      const state = String(req.query.state || '').trim();
      const baseUrl = resolveAppBaseUrl(req);
      let targetOrigin = '';
      try {
        targetOrigin = new URL(baseUrl).origin;
      } catch {
        targetOrigin = `http://127.0.0.1:${ctx.PORT}`;
      }
      const renderPopupResult = (payload: Record<string, unknown>, isError = false) => {
        const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
        const serializedOrigin = JSON.stringify(targetOrigin).replace(/</g, '\\u003c');
        res
          .status(isError ? 400 : 200)
          .send(
            `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:24px;background:#090d16;color:#e2e8f0;"><p>${
              isError
                ? 'OAuth authorization failed. You can close this window.'
                : 'Authorization complete. Returning to Studio...'
            }</p><script>try{if(window.opener){window.opener.postMessage(${serialized},${serializedOrigin});}}catch(_){}setTimeout(function(){window.close();},120);</script></body></html>`
          );
      };

      if (!provider || !code || !state) {
        renderPopupResult(
          { type: 'SUPREMEAI_GIT_OAUTH_ERROR', error: 'Missing OAuth code or state.' },
          true
        );
        return;
      }
      const savedState = oauthStateStore.get(state);
      oauthStateStore.delete(state);
      if (!savedState || savedState.provider !== provider || savedState.expiresAt < Date.now()) {
        renderPopupResult(
          { type: 'SUPREMEAI_GIT_OAUTH_ERROR', error: 'Invalid or expired OAuth state.' },
          true
        );
        return;
      }

      const callbackUrl = `${baseUrl}/api/git/oauth/${provider}/callback`;

      try {
        if (provider === 'github') {
          const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_id: process.env.GITHUB_CLIENT_ID,
              client_secret: process.env.GITHUB_CLIENT_SECRET,
              code,
              redirect_uri: callbackUrl,
            }),
          });
          const tokenData = (await tokenRes.json()) as {
            access_token?: string;
            error_description?: string;
          };
          if (!tokenRes.ok || !tokenData.access_token) {
            renderPopupResult(
              {
                type: 'SUPREMEAI_GIT_OAUTH_ERROR',
                error: tokenData.error_description || 'Token exchange failed.',
              },
              true
            );
            return;
          }
          renderPopupResult({
            type: 'SUPREMEAI_GIT_OAUTH_SUCCESS',
            provider: 'github',
            token: tokenData.access_token,
          });
          return;
        }

        const hostValidation = validateGitLabHost(savedState.host || '', process.env.GITLAB_HOST);
        if (!hostValidation.ok || !('host' in hostValidation)) {
          renderPopupResult(
            {
              type: 'SUPREMEAI_GIT_OAUTH_ERROR',
              error: 'error' in hostValidation ? hostValidation.error : 'Invalid GitLab host.',
            },
            true
          );
          return;
        }
        const host = hostValidation.host;
        const tokenRes = await fetch(`${host}/oauth/token`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: process.env.GITLAB_CLIENT_ID,
            client_secret: process.env.GITLAB_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: callbackUrl,
          }),
        });
        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          error_description?: string;
        };
        if (!tokenRes.ok || !tokenData.access_token) {
          renderPopupResult(
            {
              type: 'SUPREMEAI_GIT_OAUTH_ERROR',
              error: tokenData.error_description || 'Token exchange failed.',
            },
            true
          );
          return;
        }
        renderPopupResult({
          type: 'SUPREMEAI_GIT_OAUTH_SUCCESS',
          provider: 'gitlab',
          token: tokenData.access_token,
          host,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'OAuth exchange error';
        renderPopupResult({ type: 'SUPREMEAI_GIT_OAUTH_ERROR', error: msg }, true);
      }
    }
  );
}
