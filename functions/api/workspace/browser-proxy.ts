/**
 * Cloudflare Pages Edge Function: `/api/workspace/browser-proxy`
 * Fetches external webpages or relative `/api/*` endpoints server-side on
 * Cloudflare's Edge Network so the Virtual Browser tab renders real websites
 * with CORS/CSP/frame-busting stripped, link click bridging, interactive POST
 * form submissions, fetch/XHR RPC bridging, and Set-Cookie forwarding.
 */

import {
  buildJsonViewerHtml,
  buildTextViewerHtml,
  extractCapturedCookieHeader,
  processProxiedHtml,
} from '../../../src/shared/browserProxyHtml';
import { applyCorsHeaders, isRestrictedEdgeHost, safeEdgeFetch } from '../../_lib/edgeHelpers';

interface PagesContext {
  request: Request;
  env?: Record<string, string | undefined>;
}

const DEFAULT_UPSTREAM_ORIGIN = 'https://supremeai-api-ulw0.onrender.com';

interface ProxyRequestPayload {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  contentType?: string;
  cookie?: string;
  mode?: 'navigate' | 'rpc';
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env = {} } = context;
  const incomingUrl = new URL(request.url);
  const requestOrigin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    const preflight = new Headers({ 'Access-Control-Max-Age': '86400' });
    applyCorsHeaders(preflight, requestOrigin, incomingUrl.origin, env);
    return new Response(null, { status: 204, headers: preflight });
  }

  const jsonHeaders = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  applyCorsHeaders(jsonHeaders, requestOrigin, incomingUrl.origin, env);

  const authHeader = (request.headers.get('Authorization') || '').trim();
  const keyHeader = (request.headers.get('X-SupremeAI-Key') || '').trim();
  const cookieHeader = request.headers.get('Cookie') || '';
  const hasSessionAuth =
    authHeader.startsWith('Bearer ') ||
    Boolean(keyHeader) ||
    cookieHeader.includes('supremeai_admin_session=') ||
    cookieHeader.includes('supremeai_refresh_token=');
  if (!hasSessionAuth) {
    return new Response(
      JSON.stringify({ error: 'Authentication is required to use the workspace browser proxy.' }),
      { status: 401, headers: jsonHeaders }
    );
  }

  let payload: ProxyRequestPayload = {
    url: (incomingUrl.searchParams.get('url') || '').trim(),
    method: 'GET',
    mode: 'navigate',
  };

  if (request.method === 'POST') {
    try {
      const parsedBody = (await request.json()) as Partial<ProxyRequestPayload>;
      payload = {
        url: typeof parsedBody.url === 'string' ? parsedBody.url.trim() : '',
        method:
          typeof parsedBody.method === 'string' && parsedBody.method.trim()
            ? parsedBody.method.trim().toUpperCase()
            : 'POST',
        headers:
          parsedBody.headers && typeof parsedBody.headers === 'object' ? parsedBody.headers : {},
        body: typeof parsedBody.body === 'string' ? parsedBody.body : undefined,
        contentType:
          typeof parsedBody.contentType === 'string' ? parsedBody.contentType : undefined,
        cookie: typeof parsedBody.cookie === 'string' ? parsedBody.cookie.trim() : '',
        mode: parsedBody.mode === 'rpc' ? 'rpc' : 'navigate',
      };
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON request payload.' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
  }

  const rawTarget = payload.url;
  if (!rawTarget) {
    return new Response(JSON.stringify({ error: 'URL query parameter is required.' }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const isLocalRelative = rawTarget.startsWith('/') && !rawTarget.startsWith('//');
  const upstreamOrigin = (env.SUPREMEAI_BACKEND_URL || DEFAULT_UPSTREAM_ORIGIN).replace(/\/+$/, '');

  let parsed: URL;
  try {
    if (isLocalRelative) {
      parsed = new URL(rawTarget, upstreamOrigin);
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
    return new Response(JSON.stringify({ error: 'Invalid URL format.' }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new Response(
      JSON.stringify({ error: 'Only http:// and https:// protocols are supported.' }),
      {
        status: 400,
        headers: jsonHeaders,
      }
    );
  }

  if (isLocalRelative) {
    const p = parsed.pathname.toLowerCase();
    if (
      p.startsWith('/api/admin') ||
      p.startsWith('/api/auth') ||
      p.startsWith('/api/v1/auth') ||
      p.startsWith('/api/billing') ||
      p.startsWith('/api/workspace') ||
      p.startsWith('/api/api-keys') ||
      p.startsWith('/api/v1/api-keys') ||
      p.startsWith('/metrics')
    ) {
      return new Response(
        JSON.stringify({
          error: 'Access to privileged local API routes via browser proxy is restricted.',
        }),
        { status: 403, headers: jsonHeaders }
      );
    }
  } else if (isRestrictedEdgeHost(parsed.hostname)) {
    return new Response(
      JSON.stringify({ error: 'Access to private network / metadata addresses is restricted.' }),
      { status: 403, headers: jsonHeaders }
    );
  }

  const displayUrl = isLocalRelative ? `${parsed.pathname}${parsed.search}` : parsed.toString();
  const startTime = Date.now();
  const upstreamMethod = payload.method || 'GET';
  const isRpc = payload.mode === 'rpc';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14000);

    const vaultCookieHeader = (
      payload.cookie ||
      request.headers.get('X-Vault-Cookie') ||
      ''
    ).trim();

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

    if (payload.headers) {
      for (const [key, val] of Object.entries(payload.headers)) {
        const lower = key.toLowerCase();
        if (
          lower !== 'host' &&
          lower !== 'cookie' &&
          lower !== 'content-length' &&
          lower !== 'origin' &&
          lower !== 'referer'
        ) {
          upstreamHeaders[key] = String(val);
        }
      }
    }

    if (
      payload.contentType &&
      !upstreamHeaders['Content-Type'] &&
      !upstreamHeaders['content-type']
    ) {
      upstreamHeaders['Content-Type'] = payload.contentType;
    }

    if (vaultCookieHeader) {
      upstreamHeaders.Cookie = vaultCookieHeader;
    }

    const canHaveBody = upstreamMethod !== 'GET' && upstreamMethod !== 'HEAD';
    let response = await safeEdgeFetch(
      parsed,
      {
        method: upstreamMethod,
        headers: upstreamHeaders,
        body: canHaveBody && payload.body !== undefined ? payload.body : undefined,
      },
      14000
    );

    // Fallback for strict desktop WAF / Meta edges that return 400/403 from edge PoPs
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
      const retryRes = await safeEdgeFetch(
        mobileUrl,
        {
          method: 'GET',
          headers: mobileHeaders,
        },
        10000
      ).catch(() => null);
      if (retryRes && retryRes.ok) {
        response = retryRes;
      }
    }

    // Fallback for Wikimedia / Wikipedia datacenter IP filtering using compliant Api-User-Agent
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
      const wikiRetry = await safeEdgeFetch(
        parsed,
        {
          method: 'GET',
          headers: wikiHeaders,
        },
        10000
      ).catch(() => null);
      if (wikiRetry && wikiRetry.ok) {
        response = wikiRetry;
      }
    }
    clearTimeout(timer);

    const latencyMs = Date.now() - startTime;
    const finalUrl = !isLocalRelative && response.url ? response.url : parsed.toString();
    if (!isLocalRelative) {
      try {
        const resolvedFinal = new URL(finalUrl);
        if (
          (resolvedFinal.protocol !== 'http:' && resolvedFinal.protocol !== 'https:') ||
          isRestrictedEdgeHost(resolvedFinal.hostname)
        ) {
          return new Response(
            JSON.stringify({
              error: 'Access to private network / metadata addresses after redirect is restricted.',
            }),
            { status: 403, headers: jsonHeaders }
          );
        }
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid redirect target URL.' }), {
          status: 403,
          headers: jsonHeaders,
        });
      }
    }
    const finalDisplayUrl = isLocalRelative ? displayUrl : finalUrl;
    const contentType = response.headers.get('content-type') || 'text/html';
    const capturedCookieHeader = extractCapturedCookieHeader(response.headers);
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
      return new Response(
        JSON.stringify({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          finalUrl: finalDisplayUrl,
          latencyMs,
          headers: rpcHeaders,
          body: rawBody.slice(0, 1_500_000),
          ...(capturedCookieHeader ? { capturedCookieHeader } : {}),
        }),
        { status: 200, headers: jsonHeaders }
      );
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
      return new Response(
        JSON.stringify({
          url: finalDisplayUrl,
          title: `JSON Response · ${isLocalRelative ? finalDisplayUrl : new URL(finalUrl).hostname}`,
          statusCode: response.status,
          latencyMs,
          contentType,
          headers: headerSummary,
          rawSource: pretty.slice(0, 60000),
          html: jsonHtml,
          extractedLinks: [],
          textPreview: pretty.slice(0, 800),
          ...(capturedCookieHeader ? { capturedCookieHeader } : {}),
        }),
        { status: 200, headers: jsonHeaders }
      );
    }

    const isHtmlLike =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml') ||
      /<(?:!doctype|html|head|body)\b/i.test(rawBody.slice(0, 1024));

    if (!isHtmlLike) {
      const textHtml = buildTextViewerHtml(rawBody);
      return new Response(
        JSON.stringify({
          url: finalDisplayUrl,
          title: `${new URL(finalUrl).hostname} (${contentType.split(';')[0]})`,
          statusCode: response.status,
          latencyMs,
          contentType,
          headers: headerSummary,
          rawSource: rawBody.slice(0, 60000),
          html: textHtml,
          extractedLinks: [],
          textPreview: rawBody.slice(0, 800),
          ...(capturedCookieHeader ? { capturedCookieHeader } : {}),
        }),
        { status: 200, headers: jsonHeaders }
      );
    }

    const {
      title,
      html: cleanHtml,
      extractedLinks,
      textPreview,
    } = processProxiedHtml(rawBody, finalUrl, new URL(finalUrl).hostname);

    return new Response(
      JSON.stringify({
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
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error fetching URL';
    return new Response(
      JSON.stringify({
        error: `Could not load ${displayUrl}: ${msg}`,
        url: displayUrl,
      }),
      { status: 502, headers: jsonHeaders }
    );
  }
}
