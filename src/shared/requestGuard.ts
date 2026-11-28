/**
 * Runtime-agnostic abuse guards shared by the Node Studio server and the
 * Cloudflare Pages Edge workers.
 *
 * WHY THIS EXISTS (audit 2026-11-24, item 1.4)
 *   The autonomous agent endpoints spent server-held model keys without any
 *   per-identity budget. A shared, dependency-free sliding-window limiter lets
 *   both runtimes enforce identical policy without reaching for external
 *   state (Redis/KV), which neither path guarantees.
 *
 * SCOPE / LIMITS
 *   - In-memory only: per-isolate (Edge) or per-process (Node). This is a
 *     deterrent and cost guard, not a distributed quota — the backend API
 *     remains the source of truth for plan-level quotas.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the next event would be allowed (0 when allowed). */
  retryAfterSec: number;
  /** Events remaining in the current window (0 when denied). */
  remaining: number;
}

export interface SlidingWindowOptions {
  /** Maximum events allowed per window per key. */
  maxEvents: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Maximum distinct keys tracked before the oldest keys are evicted.
   * Prevents unbounded memory growth from spoofed key churn.
   * Defaults to 5000.
   */
  maxTrackedKeys?: number;
}

export type SlidingWindowRateLimiter = (key: string) => RateLimitDecision;

/**
 * Creates a pure in-memory sliding-window rate limiter.
 * Identical semantics in Node and Edge runtimes; no timers scheduled.
 */
export function createSlidingWindowRateLimiter(options: SlidingWindowOptions): SlidingWindowRateLimiter {
  const maxEvents = Math.max(1, Math.floor(options.maxEvents));
  const windowMs = Math.max(1000, Math.floor(options.windowMs));
  const maxTrackedKeys = Math.max(100, Math.floor(options.maxTrackedKeys ?? 5000));
  const hits = new Map<string, number[]>();

  const evictIfNeeded = (now: number): void => {
    if (hits.size <= maxTrackedKeys) return;
    const cutoff = now - windowMs;
    for (const [k, stamps] of hits.entries()) {
      if (stamps.length === 0 || stamps[stamps.length - 1] <= cutoff) {
        hits.delete(k);
      }
    }
    if (hits.size <= maxTrackedKeys) return;
    // Drop the oldest half by first-hit timestamp to bound memory.
    const entries = Array.from(hits.entries())
      .map(([key, stamps]) => ({ key, oldest: stamps[0] ?? 0 }))
      .sort((a, b) => a.oldest - b.oldest);
    const toDrop = Math.ceil(entries.length / 2);
    for (let i = 0; i < toDrop; i += 1) {
      hits.delete(entries[i].key);
    }
  };

  return (key: string): RateLimitDecision => {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) {
      return { allowed: false, retryAfterSec: Math.ceil(windowMs / 1000), remaining: 0 };
    }
    const now = Date.now();
    const cutoff = now - windowMs;
    const stamps = (hits.get(cleanKey) || []).filter((t) => t > cutoff);

    if (stamps.length >= maxEvents) {
      hits.set(cleanKey, stamps);
      evictIfNeeded(now);
      const oldest = stamps[0] ?? now;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        remaining: 0,
      };
    }

    stamps.push(now);
    hits.set(cleanKey, stamps);
    evictIfNeeded(now);
    return { allowed: true, retryAfterSec: 0, remaining: maxEvents - stamps.length };
  };
}

/** Extracts the best-effort client IP from proxy-aware headers. */
export function extractClientIp(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get('cf-connecting-ip') || headers.get('x-real-ip') || '';
  if (forwarded.trim()) return forwarded.trim();
  const chain = headers.get('x-forwarded-for') || '';
  const first = chain.split(',')[0]?.trim();
  return first || 'unknown';
}
