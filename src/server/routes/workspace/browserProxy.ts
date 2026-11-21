import type { Express, Request, Response as ExpressResponse } from 'express';
import {
  isRestrictedProxyTarget,
  resolveAndCheckProxyTarget,
} from '../../../shared/serverSecurity';
import {
  buildJsonViewerHtml,
  buildTextViewerHtml,
  extractCapturedCookieHeader,
  processProxiedHtml,
} from '../../../shared/browserProxyHtml';

/**
 * Workspace Browser Proxy — split-workspace-dock browser fetch & render
 *
 * WHY THIS FILE EXISTS
 *   The server-side browser proxy (`POST/GET /api/workspace/browser-proxy`)
 *   lived inline in the monolith's `startServer()` closure (~340 lines).
 *   It shares no mutable state with the vault/schedule stores — only pure
 *   helpers and the SSRF-hardened fetch wrapper. Moving it keeps the
 *   monolith shrinking with a minimal ctx (PORT + safeFetch helper).
 *
 * CONTRACT WITH server.ts
 *   - `requireAuthMiddleware` stays in server.ts as
 *     `app.use('/api/workspace', requireAuthMiddleware)` registered before
 *     this call, so the proxy remains authenticated.
 *   - `PORT` and `safeFetchWithRedirectCheck` are injected via `ctx` because
 *     they are closed over inside `startServer()` and cannot be imported.
 *   - All shared helpers (`resolveAndCheckProxyTarget`,
 *     `isRestrictedProxyTarget`, browserProxyHtml) are imported directly from
 *     `src/shared/*` — no ctx indirection needed.
 *   - Registration order is preserved: the `register…` call replaces the
 *     inline `app.all('/api/workspace/browser-proxy', …)` at the same site.
 */

export interface WorkspaceBrowserProxyContext {
  PORT: number;
  safeFetchWithRedirectCheck: (
    initialUrl: string | URL,
    init?: RequestInit,
    isLocalRelative?: boolean,
    maxRedirects?: number
  ) => Promise<globalThis.Response>;
}

export function registerWorkspaceBrowserProxyRoutes(
  app: Express,
  ctx: WorkspaceBrowserProxyContext
): void {
  app.all('/api/workspace/browser-proxy', async (req: Request, res: ExpressResponse) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const reqBody =
      req.method === 'POST' && req.body && typeof req.body === 'object' ? req.body : {};
    const rawTarget =
      req.method === 'POST'
        ? String((reqBody as Record<string, unknown>).url || req.query.url || '').trim()
        : String(req.query.url || '').trim();

    if (!rawTarget) {
      res.status(400).json({ error: 'URL query parameter is required.' });
      return;
    }

    const upstreamMethod =
      req.method === 'POST' &&
      typeof (reqBody as Record<string, unknown>).method === 'string' &&
      String((reqBody as Record<string, unknown>).method).trim()
        ? String((reqBody as Record<string, unknown>).method).trim().toUpperCase()
        : req.method === 'POST'
          ? 'POST'
          : 'GET';
    const isRpc = req.method === 'POST' && (reqBody as Record<string, unknown>).mode === 'rpc';
    const customHeaders =
      req.method === 'POST' &&
      (reqBody as Record<string, unknown>).headers &&
      typeof (reqBody as Record<string, unknown>).headers === 'object'
        ? ((reqBody as Record<string, unknown>).headers as Record<string, string>)
        : {};
    const forwardBody =
      req.method === 'POST' && typeof (reqBody as Record<string, unknown>).body === 'string'
        ? String((reqBody as Record<string, unknown>).body)
        : undefined;
    const forwardContentType =
      req.method === 'POST' && typeof (reqBody as Record<string, unknown>).contentType === 'string'
        ? String((reqBody as Record<string, unknown>).contentType)
        : undefined;
    const bodyCookie =
      req.method === 'POST' && typeof (reqBody as Record<string, unknown>).cookie === 'string'
        ? String((reqBody as Record<string, unknown>).cookie).trim()
        : '';

    const isLocalRelative = rawTarget.startsWith('/') && !rawTarget.startsWith('//');
    let parsed: URL;
    try {
      if (isLocalRelative) {
        parsed = new URL(rawTarget, `http://127.0.0.1:${ctx.PORT}`);
      } else if (rawTarget.startsWith('//')) {
        parsed = new URL(`https:${rawTarget}`);
      } else {
        parsed = new URL(
          rawTarget.startsWith('http://') || rawTarget.startsWith('https://')
            ? rawTarget
            : `https://${rawTarget}`
        );
      }
    } catch {
      res.status(400).json({ error: 'Invalid URL format.' });
      return;
    }

    const proxyRestriction = await resolveAndCheckProxyTarget(parsed, isLocalRelative);
    if (proxyRestriction.restricted) {
      res.status(403).json({
        error:
          proxyRestriction.reason || 'Access to restricted or private network addresses is denied.',
      });
      return;
    }

    const displayUrl = isLocalRelative ? `${parsed.pathname}${parsed.search}` : parsed.toString();
    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);

      const vaultCookieHeader = (bodyCookie || req.header('x-vault-cookie') || '').trim();
      const upstreamHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
        Accept: isRpc
          ? 'application/json, text/plain, */*'
          : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
        'Cache-Control': 'max-age=0',
        'Sec-Ch-Ua': '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': isRpc ? 'empty' : 'document',
        'Sec-Fetch-Mode': isRpc ? 'cors' : 'navigate',
        'Sec-Fetch-Site': upstreamMethod !== 'GET' || isRpc ? 'same-origin' : 'none',
        ...(isRpc ? {} : { 'Sec-Fetch-User': '?1', 'Upgrade-Insecure-Requests': '1' }),
      };

      if (upstreamMethod !== 'GET' || isRpc) {
        upstreamHeaders.Origin = parsed.origin;
        upstreamHeaders.Referer = `${parsed.origin}/`;
      }

      for (const [k, v] of Object.entries(customHeaders)) {
        const lower = k.toLowerCase();
        if (
          lower !== 'host' &&
          lower !== 'cookie' &&
          lower !== 'content-length' &&
          lower !== 'origin' &&
          lower !== 'referer'
        ) {
          upstreamHeaders[k] = String(v);
        }
      }

      if (
        forwardContentType &&
        !upstreamHeaders['Content-Type'] &&
        !upstreamHeaders['content-type']
      ) {
        upstreamHeaders['Content-Type'] = forwardContentType;
      }

      if (vaultCookieHeader && !proxyRestriction.restricted) {
        upstreamHeaders.Cookie = vaultCookieHeader;
      }

      const canHaveBody = upstreamMethod !== 'GET' && upstreamMethod !== 'HEAD';
      let response = await ctx.safeFetchWithRedirectCheck(
        parsed,
        {
          method: upstreamMethod,
          signal: controller.signal,
          headers: upstreamHeaders,
          body: canHaveBody && forwardBody !== undefined ? forwardBody : undefined,
        },
        isLocalRelative
      );

      if (
        upstreamMethod === 'GET' &&
        (response.status === 400 || response.status === 403) &&
        /(?:^|\.)(?:fb\.com|facebook\.com)$/i.test(parsed.hostname) &&
        !/^m\.facebook\.com$/i.test(parsed.hostname)
      ) {
        const mobileUrl = new URL(parsed.toString());
        mobileUrl.hostname = 'm.facebook.com';
        const mobileHeaders: Record<string, string> = {
          ...upstreamHeaders,
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36',
          'Sec-Ch-Ua-Mobile': '?1',
          'Sec-Ch-Ua-Platform': '"Android"',
        };
        const retryRes = await ctx
          .safeFetchWithRedirectCheck(
            mobileUrl,
            {
              signal: controller.signal,
              headers: mobileHeaders,
            },
            false
          )
          .catch(() => null);
        if (retryRes && retryRes.ok) {
          response = retryRes;
        }
      }
      if (
        upstreamMethod === 'GET' &&
        (response.status === 403 || response.status === 429) &&
        /(?:^|\.)(?:wikipedia\.org|wikimedia\.org|wiktionary\.org)$/i.test(parsed.hostname)
      ) {
        const wikiHeaders: Record<string, string> = {
          ...upstreamHeaders,
          'User-Agent': 'SupremeAI-Studio-Browser/1.0 (https://supremeai-studio.pages.dev)',
          'Api-User-Agent': 'SupremeAI-Studio-Browser/1.0 (https://supremeai-studio.pages.dev)',
        };
        const wikiRetry = await ctx
          .safeFetchWithRedirectCheck(
            parsed,
            {
              signal: controller.signal,
              headers: wikiHeaders,
            },
            false
          )
          .catch(() => null);
        if (wikiRetry && wikiRetry.ok) {
          response = wikiRetry;
        }
      }
      clearTimeout(timer);

      const latencyMs = Date.now() - startTime;
      const finalUrl = !isLocalRelative && response.url ? response.url : parsed.toString();
      if (!isLocalRelative) {
        try {
          const postRedirectCheck = isRestrictedProxyTarget(new URL(finalUrl), false);
          if (postRedirectCheck.restricted) {
            res.status(403).json({
              error:
                postRedirectCheck.reason ||
                'Access to restricted or private network addresses after redirect is denied.',
            });
            return;
          }
        } catch {
          res.status(403).json({ error: 'Invalid redirect target URL.' });
          return;
        }
      }
      const finalDisplayUrl = isLocalRelative ? displayUrl : finalUrl;
      const finalHostname = (() => {
        try {
          return new URL(finalUrl).hostname;
        } catch {
          return parsed.hostname;
        }
      })();
      const contentType = response.headers.get('content-type') || 'text/html';
      const capturedCookieHeader = extractCapturedCookieHeader(
        response.headers as unknown as Headers
      );
      const rawBody = await response.text();

      if (isRpc) {
        const rpcHeaders: Record<string, string> = {};
        response.headers.forEach((v, k) => {
          const lower = k.toLowerCase();
          if (
            lower !== 'set-cookie' &&
            lower !== 'content-encoding' &&
            lower !== 'content-length' &&
            lower !== 'transfer-encoding'
          ) {
            rpcHeaders[k] = v;
          }
        });
        res.json({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          finalUrl: finalDisplayUrl,
          latencyMs,
          headers: rpcHeaders,
          body: rawBody.slice(0, 1_500_000),
          ...(capturedCookieHeader ? { capturedCookieHeader } : {}),
        });
        return;
      }

      const headerSummary: Record<string, string> = {};
      ['content-type', 'cache-control', 'server', 'x-powered-by', 'date'].forEach((h) => {
        const val = response.headers.get(h);
        if (val) headerSummary[h] = val;
      });

      if (contentType.includes('application/json')) {
        const pretty = (() => {
          try {
            return JSON.stringify(JSON.parse(rawBody), null, 2);
          } catch {
            return rawBody;
          }
        })();
        const jsonHtml = buildJsonViewerHtml(pretty);
        res.json({
          url: finalDisplayUrl,
          title: `JSON Response · ${isLocalRelative ? finalDisplayUrl : finalHostname}`,
          statusCode: response.status,
          latencyMs,
          contentType,
          headers: headerSummary,
          rawSource: pretty.slice(0, 60000),
          html: jsonHtml,
          extractedLinks: [],
          textPreview: pretty.slice(0, 800),
          ...(capturedCookieHeader ? { capturedCookieHeader } : {}),
        });
        return;
      }

      const isHtmlLike =
        contentType.includes('text/html') ||
        contentType.includes('application/xhtml') ||
        /<(?:!doctype|html|head|body)\b/i.test(rawBody.slice(0, 1024));

      if (!isHtmlLike) {
        const textHtml = buildTextViewerHtml(rawBody);
        res.json({
          url: finalDisplayUrl,
          title: `${finalHostname} (${contentType.split(';')[0]})`,
          statusCode: response.status,
          latencyMs,
          contentType,
          headers: headerSummary,
          rawSource: rawBody.slice(0, 60000),
          html: textHtml,
          extractedLinks: [],
          textPreview: rawBody.slice(0, 800),
          ...(capturedCookieHeader ? { capturedCookieHeader } : {}),
        });
        return;
      }

      const {
        title,
        html: cleanHtml,
        extractedLinks,
        textPreview,
      } = processProxiedHtml(rawBody, finalUrl, finalHostname);

      res.json({
        url: finalDisplayUrl,
        title: title || finalDisplayUrl,
        statusCode: response.status,
        latencyMs,
        contentType,
        headers: headerSummary,
        rawSource: rawBody.slice(0, 60000),
        html: cleanHtml,
        extractedLinks,
        textPreview,
        ...(capturedCookieHeader ? { capturedCookieHeader } : {}),
      });
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Network error fetching URL';
      res.status(502).json({
        error: `Could not load ${displayUrl}: ${msg}`,
        url: displayUrl,
      });
    }
  });
}
