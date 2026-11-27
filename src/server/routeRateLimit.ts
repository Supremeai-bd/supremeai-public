import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

/**
 * Route Rate Limit — `express-rate-limit` factory for per-route / per-area guards.
 *
 * WHY THIS FILE EXISTS
 *   server.ts already has a prefix limiter (`httpGuards.createRateLimiter`), but
 *   CodeQL's `js/missing-rate-limiting` only recognises well-known libraries, and
 *   auth/DB-touching handlers (API keys, billing, admin + workspace auth gates)
 *   were reported as unthrottled. This is the same pattern `authTotp.ts` uses,
 *   in one place so every caller gets identical headers/keys/messages.
 *
 * KEYING
 *   - `scope: 'route'` (default): `${req.path}:${ip}` — one bucket per route per
 *     IP, so a busy route can't starve its siblings on the same limiter.
 *   - `scope: 'area'`: IP only — one bucket for a whole `app.use(prefix, …)` area.
 *   `ipKeyGenerator` groups IPv6 addresses by /56 (raw `req.ip` triggers
 *   ERR_ERL_KEY_GEN_IPV6).
 */
export interface RouteRateLimitOptions {
  /** Window length in ms (default 60 s). */
  windowMs?: number;
  scope?: 'route' | 'area';
  message?: string;
}

export function routeRateLimit(
  limit: number,
  { windowMs = 60_000, scope = 'route', message }: RouteRateLimitOptions = {}
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const ip = ipKeyGenerator(req.ip || 'unknown');
      return scope === 'area' ? ip : `${req.path}:${ip}`;
    },
    message: { error: message || 'Too many requests. Please wait a moment and retry.' },
  });
}
