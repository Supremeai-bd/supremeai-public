/**
 * Cloudflare Pages Same-Origin Reverse Proxy for SupremeAI API (`/api/*`).
 * Forwards all `/api/*` requests to `https://supremeai-api-ulw0.onrender.com/api/*`
 * (or `env.SUPREMEAI_BACKEND_URL` if configured), eliminating cross-domain CORS
 * preflights and third-party ad-blocker/tracker false positives while preserving
 * unbuffered SSE (`text/event-stream`) streaming.
 */

import {
  applyCorsHeaders,
  buildUpstreamForwardHeaders,
  FALLBACK_UPSTREAM_ORIGIN,
  resolveUpstreamOrigin,
} from '../_lib/edgeHelpers';
import { enforceAuthCaptcha } from '../_lib/turnstile';

interface PagesContext {
  request: Request;
  env?: Record<string, string | undefined>;
  params?: { path?: string | string[] };
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env = {} } = context;
  const incomingUrl = new URL(request.url);
  const requestOrigin = request.headers.get('Origin');

  if (request.method === 'OPTIONS') {
    const preflightHeaders = new Headers({
      'Access-Control-Max-Age': '86400',
    });
    applyCorsHeaders(preflightHeaders, requestOrigin, incomingUrl.origin, env);
    return new Response(null, {
      status: 204,
      headers: preflightHeaders,
    });
  }

  const upstreamOrigin = resolveUpstreamOrigin(env);
  const targetUrl = `${upstreamOrigin}${incomingUrl.pathname}${incomingUrl.search}`;

  const forwardedHeaders = buildUpstreamForwardHeaders(request, incomingUrl);

  // Turnstile gate for login/register (no-op until TURNSTILE_SECRET_KEY is set).
  const captchaRejection = await enforceAuthCaptcha(
    request,
    incomingUrl.pathname,
    env,
    forwardedHeaders
  );
  if (captchaRejection) {
    applyCorsHeaders(captchaRejection.headers, requestOrigin, incomingUrl.origin, env);
    return captchaRejection;
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const cookieHeader = forwardedHeaders.get('cookie') || '';
  const isGuestChatRoute =
    request.method === 'POST' &&
    (incomingUrl.pathname === '/api/v1/stream/chat' ||
      incomingUrl.pathname === '/v1/chat/completions');
  let mintedGuestSetCookie: string | null = null;

  // Transparently mint a signed short-lived guest trial token when an unauthenticated
  // guest calls chat before client-side token warming completes.
  if (
    isGuestChatRoute &&
    !forwardedHeaders.has('authorization') &&
    !forwardedHeaders.has('x-supremeai-key') &&
    !cookieHeader.includes('supremeai_guest_session=')
  ) {
    try {
      const guestHeaders = new Headers({ Accept: 'application/json' });
      const clientIp = request.headers.get('cf-connecting-ip');
      if (clientIp) guestHeaders.set('X-Forwarded-For', clientIp);

      const guestRes = await fetch(`${upstreamOrigin}/api/v1/auth/guest`, {
        method: 'POST',
        headers: guestHeaders,
      });
      if (guestRes.ok) {
        mintedGuestSetCookie = guestRes.headers.get('set-cookie');
        const guestJson = (await guestRes.json().catch(() => null)) as {
          access_token?: string;
          token?: string;
        } | null;
        const guestToken = guestJson?.access_token || guestJson?.token;
        if (guestToken) {
          forwardedHeaders.set('Authorization', `Bearer ${guestToken}`);
          forwardedHeaders.set('X-SupremeAI-Key', guestToken);
        }
      }
    } catch {
      // Continue and let upstream handle response
    }
  }

  try {
    const bufferedBody = hasBody && request.body ? await request.arrayBuffer() : undefined;
    const buildInit = (): RequestInit => ({
      method: request.method,
      headers: forwardedHeaders,
      body: bufferedBody,
      redirect: 'manual',
    });
    let upstreamResponse = await fetch(targetUrl, buildInit());

    // বাংলা মন্তব্য: প্রাইমারি আপস্ট্রিম 502/503/504 বা Cloudflare 403/429 চ্যালেঞ্জ রিটার্ন করলে কিংবা নির্দিষ্ট রুট 404 হলে ফলব্যাক আপস্ট্রিমে (Core API) চেষ্টা করা হবে
    const isCfChallenge =
      (upstreamResponse.status === 403 || upstreamResponse.status === 429) &&
      (upstreamResponse.headers.get('cf-mitigated') === 'challenge' ||
        (upstreamResponse.headers.get('content-type') || '').includes('text/html'));
    const isCoreRoute404 =
      upstreamResponse.status === 404 &&
      (incomingUrl.pathname.startsWith('/api/v1/ecosystem') ||
        incomingUrl.pathname.startsWith('/api/v1/agents') ||
        incomingUrl.pathname.startsWith('/api/v1/memory') ||
        incomingUrl.pathname.startsWith('/api/v1/evolution') ||
        incomingUrl.pathname === '/api/v1/status' ||
        incomingUrl.pathname === '/api/v1/dashboard' ||
        incomingUrl.pathname === '/api/v1/health/live');
    if (
      !upstreamResponse.ok &&
      ([502, 503, 504].includes(upstreamResponse.status) || isCfChallenge || isCoreRoute404)
    ) {
      try {
        const fallbackTarget = `${FALLBACK_UPSTREAM_ORIGIN}${incomingUrl.pathname}${incomingUrl.search}`;
        const fallbackRes = await fetch(fallbackTarget, buildInit());
        if (
          fallbackRes.ok ||
          fallbackRes.status === 401 ||
          fallbackRes.status === 400 ||
          fallbackRes.status === 422
        ) {
          upstreamResponse = fallbackRes;
        }
      } catch {
        // Fallback fetch failed, retain original response
      }
    }

    // বাংলা মন্তব্য: যদি আপস্ট্রিম থেকে এখনো HTML ভিত্তিক Cloudflare চ্যালেঞ্জ (403/429) আসে, তবে কাঁচা HTML না পাঠিয়ে পরিষ্কার JSON এরর পাঠানো হবে যাতে ক্লায়েন্ট সরাসরি ডাইরেক্ট আপস্ট্রিম ফেইলওভার করতে পারে
    const finalContentType = upstreamResponse.headers.get('content-type') || '';
    const finalIsCfChallenge =
      (upstreamResponse.status === 403 || upstreamResponse.status === 429) &&
      (upstreamResponse.headers.get('cf-mitigated') === 'challenge' ||
        finalContentType.includes('text/html'));
    if (finalIsCfChallenge) {
      const challengeHeaders = new Headers({
        'Content-Type': 'application/json; charset=utf-8',
        'X-SupremeAI-Edge-Challenge': '1',
      });
      applyCorsHeaders(challengeHeaders, requestOrigin, incomingUrl.origin, env);
      return new Response(
        JSON.stringify({
          error: 'Upstream edge relay rate-limited by Cloudflare Bot Management.',
          code: 'CF_EDGE_CHALLENGE',
          retryDirectUpstream: true,
        }),
        {
          status: 503,
          headers: challengeHeaders,
        }
      );
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    if (mintedGuestSetCookie && !responseHeaders.has('set-cookie')) {
      responseHeaders.set('set-cookie', mintedGuestSetCookie);
    }
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');
    responseHeaders.delete('connection');
    responseHeaders.delete('keep-alive');

    // Keep any upstream redirects same-origin so the Render URL is not exposed to the browser
    const location = responseHeaders.get('location');
    if (location && location.startsWith(upstreamOrigin)) {
      responseHeaders.set('location', location.slice(upstreamOrigin.length) || '/');
    }

    // Normalize CORS headers for allowlisted origins without arbitrary reflection
    applyCorsHeaders(responseHeaders, requestOrigin, incomingUrl.origin, env);

    // Preserve streaming SSE responses without buffering
    const contentType = responseHeaders.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      responseHeaders.set('Cache-Control', 'no-cache, no-transform');
      responseHeaders.set('X-Accel-Buffering', 'no');
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const errorHeaders = new Headers({ 'Content-Type': 'application/json' });
    applyCorsHeaders(errorHeaders, requestOrigin, incomingUrl.origin, env);
    return new Response(
      JSON.stringify({
        error: 'Upstream API gateway unreachable via same-origin proxy.',
        detail: err instanceof Error ? err.message : 'Proxy fetch error',
      }),
      {
        status: 502,
        headers: errorHeaders,
      }
    );
  }
}
