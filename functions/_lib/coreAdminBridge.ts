/**
 * বাংলা মন্তব্য: অ্যাডমিন প্যানেল (edge) → core (supremeai-primary) সেতু।
 *
 * সমস্যা: ব্রাউজারের লগইন টোকেন gateway-র দেওয়া; core-এর অ্যাডমিন রাউট সেটা চেনে না, আর gateway
 * `/api/admin/llm/*` core-এ পাঠায় না — তাই অ্যাডমিন প্যানেল থেকে core-এর আসল কন্ট্রোলে পৌঁছানোর
 * কোনো পথ ছিল না।
 *
 * সমাধান: edge আগে নিজে অ্যাডমিন যাচাই করে (`authorizeAdminRequest`), তারপর core-এর নিজস্ব
 * সার্ভিস টোকেন (`SUPREMEAI_API_TOKEN`, core এটাকে system-admin হিসেবে চেনে) দিয়ে ডাকে।
 * টোকেন আসে Cloudflare env থেকে, না থাকলে Infisical থেকে (core-ও একই Infisical থেকে পড়ে) —
 * তাই আলাদা করে কিছু সেট করতে হয় না। টোকেন কখনো ব্রাউজারে বা রেসপন্সে যায় না।
 */

import { FALLBACK_UPSTREAM_ORIGIN } from './edgeHelpers';
import { missingInfisicalEnv, readInfisicalSecrets } from './providerVault';

type Env = Record<string, string | undefined> | undefined;

export const CORE_TOKEN_NAMES = ['SUPREMEAI_API_TOKEN', 'SUPREMEAI_API_KEY'] as const;
const HIT_TTL_MS = 5 * 60_000;
const MISS_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 25_000; // free-plan core can take a while to wake up

let tokenCache: { token: string | null; source: string; expires: number } | null = null;

/** Test hook — forget the cached token. */
export function resetCoreTokenCache(): void {
  tokenCache = null;
}

export function resolveCoreOrigin(env: Env): string {
  return String(env?.SUPREMEAI_CORE_URL || env?.CORE_API_URL || FALLBACK_UPSTREAM_ORIGIN)
    .trim()
    .replace(/\/+$/, '');
}

export async function resolveCoreServiceToken(
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<{ token: string | null; source: 'edge-env' | 'infisical' | 'missing' }> {
  for (const name of CORE_TOKEN_NAMES) {
    const value = String(env?.[name] || '').trim();
    if (value) return { token: value, source: 'edge-env' };
  }
  if (tokenCache && tokenCache.expires > Date.now()) {
    return tokenCache.token
      ? { token: tokenCache.token, source: 'infisical' }
      : { token: null, source: 'missing' };
  }
  let token: string | null = null;
  if (missingInfisicalEnv(env).length === 0) {
    try {
      const { secrets } = await readInfisicalSecrets(env, fetchImpl);
      for (const name of CORE_TOKEN_NAMES) {
        const hit = secrets.find((s) => s.name === name && s.value.trim());
        if (hit) {
          token = hit.value.trim();
          break;
        }
      }
    } catch {
      token = null;
    }
  }
  tokenCache = {
    token,
    source: token ? 'infisical' : 'missing',
    expires: Date.now() + (token ? HIT_TTL_MS : MISS_TTL_MS),
  };
  return token ? { token, source: 'infisical' } : { token: null, source: 'missing' };
}

export type CoreCallResult =
  | { ok: true; status: number; data: unknown }
  | {
      ok: false;
      status: number;
      reason: 'not-linked' | 'unreachable' | 'rejected' | 'not-deployed';
      data?: unknown;
    };

/** Calls a core admin route with the core service token. Never throws. */
export async function callCoreAdmin(
  env: Env,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<CoreCallResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { token } = await resolveCoreServiceToken(env, fetchImpl);
  if (!token) return { ok: false, status: 503, reason: 'not-linked' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${resolveCoreOrigin(env)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return { ok: true, status: res.status, data };
    if (res.status === 404 || res.status === 405) {
      return { ok: false, status: res.status, reason: 'not-deployed', data };
    }
    if (res.status === 401 || res.status === 403) {
      // A stale cached token is the most likely cause — re-read it next time.
      tokenCache = null;
    }
    return { ok: false, status: res.status, reason: 'rejected', data };
  } catch {
    return { ok: false, status: 504, reason: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Plain explanation + HTTP status for a failed core call (no secrets). */
export function describeCoreFailure(result: Extract<CoreCallResult, { ok: false }>): {
  status: number;
  error: string;
  linked: boolean;
  notWired?: boolean;
} {
  switch (result.reason) {
    case 'not-linked':
      return {
        status: 503,
        linked: false,
        error:
          'Core not linked — SUPREMEAI_API_TOKEN was not found in Cloudflare env or Infisical.',
      };
    case 'unreachable':
      return {
        status: 504,
        linked: true,
        error: 'Core did not answer in time (it may be waking up) — try again shortly.',
      };
    case 'not-deployed':
      return {
        status: 501,
        linked: true,
        notWired: true,
        error: 'This control is not deployed on core yet.',
      };
    default: {
      const detail = (result.data as { detail?: unknown } | null)?.detail;
      return {
        status: result.status >= 500 ? 502 : result.status,
        linked: true,
        error:
          typeof detail === 'string' && detail
            ? detail.slice(0, 300)
            : `Core rejected the request (HTTP ${result.status}).`,
      };
    }
  }
}
