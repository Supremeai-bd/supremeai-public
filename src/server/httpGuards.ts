/**
 * বাংলা মন্তব্য: server.ts থেকে হুবহু সরানো HTTP গার্ড (SERVER_TS_SPLIT_PLAN, আইটেম ৫)।
 * কোনো closure নির্ভরতা নেই — তাই startServer()-এর বাইরে মডিউল-লেভেলে রাখা নিরাপদ।
 *  - isHttpsRequest: HSTS + secure কুকির জন্য
 *  - safeFetchWithRedirectCheck: SSRF-রোধী আউটবাউন্ড fetch (প্রতিটা redirect hop-এ DNS/IP যাচাই)
 *  - createRateLimiter: per-IP sliding-window rate limiter
 */
import type { NextFunction, Request, Response } from 'express';
import { resolveAndCheckProxyTarget } from '../shared/serverSecurity';

export const isHttpsRequest = (req: Request): boolean => {
  const protoHeader = String(req.header('x-forwarded-proto') || '').toLowerCase();
  const forwardedHeader = String(req.header('forwarded') || '').toLowerCase();
  const originHeader = String(req.header('origin') || '').toLowerCase();
  const refererHeader = String(req.header('referer') || '').toLowerCase();
  return (
    req.secure ||
    protoHeader.includes('https') ||
    forwardedHeader.includes('proto=https') ||
    originHeader.startsWith('https://') ||
    refererHeader.startsWith('https://')
  );
};

// SSRF-hardened outbound fetch helper: validates hostname + resolved DNS IPs on initial request and every redirect hop
export const safeFetchWithRedirectCheck = async (
  initialUrl: string | URL,
  init: RequestInit = {},
  isLocalRelative = false,
  maxRedirects = 5
): Promise<globalThis.Response> => {
  let currentUrl = typeof initialUrl === 'string' ? new URL(initialUrl) : initialUrl;
  let currentLocal = isLocalRelative;
  let currentInit: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const check = await resolveAndCheckProxyTarget(currentUrl, currentLocal);
    if (check.restricted) {
      throw new Error(check.reason || 'Blocked outbound request to restricted or private target.');
    }

    const response = await fetch(currentUrl.toString(), currentInit);
    if (
      response.status === 301 ||
      response.status === 302 ||
      response.status === 303 ||
      response.status === 307 ||
      response.status === 308
    ) {
      const location = response.headers.get('location');
      if (!location) return response;
      if (hop === maxRedirects) {
        throw new Error('Too many redirects from upstream target.');
      }
      const nextUrl = new URL(location, currentUrl);
      currentLocal =
        currentLocal && nextUrl.origin === currentUrl.origin && nextUrl.pathname.startsWith('/');
      currentUrl = nextUrl;
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          currentInit.method &&
          currentInit.method.toUpperCase() === 'POST')
      ) {
        currentInit = { ...currentInit, method: 'GET', body: undefined };
      }
      continue;
    }
    return response;
  }

  throw new Error('Redirect limit exceeded.');
};

// Zero-dependency in-memory sliding-window rate limiter (per client IP).
// Each call owns its own bucket map, exactly like the inline version did.
export function createRateLimiter() {
  const rateBuckets = new Map<string, number[]>();
  const makeRateLimit = (windowMs: number, max: number) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
      const bucketKey = `${req.baseUrl || req.path}:${ip}`;
      const now = Date.now();
      const hits = (rateBuckets.get(bucketKey) || []).filter((t) => now - t < windowMs);
      if (hits.length >= max) {
        res.status(429).json({ error: 'Too many requests. Please slow down and retry shortly.' });
        return;
      }
      hits.push(now);
      rateBuckets.set(bucketKey, hits);
      if (rateBuckets.size > 10000) {
        for (const [k, v] of rateBuckets) {
          if (v.length === 0 || now - v[v.length - 1] > windowMs) rateBuckets.delete(k);
        }
      }
      next();
    };
  };
  return makeRateLimit;
}

// express-rate-limit factory (recognised by CodeQL); re-exported so server.ts keeps one import.
export { routeRateLimit } from './routeRateLimit';
