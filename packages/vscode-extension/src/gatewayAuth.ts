/**
 * বাংলা মন্তব্য: VSIX → গেটওয়ে অথেনটিকেশন (P0: VSIX 401 ফিক্স)।
 *
 * আগে API key না থাকলে এক্সটেনশন `X-SupremeAI-Key: guest` আক্ষরিক স্ট্রিং পাঠাত।
 * গেটওয়ে (auth_verification.py) এখন আর কোনো ক্লায়েন্ট-দেওয়া "guest" টোকেনে
 * অ্যাক্সেস দেয় না — শুধু সার্ভারের সাইন করা, স্বল্পমেয়াদি guest টোকেন
 * (POST /api/v1/auth/guest) গ্রহণযোগ্য। তাই প্রতিটা VSIX চ্যাট 401 পেত।
 *
 * এখন:
 *  - নিজের key থাকলে সেটাই Bearer হিসেবে যায়।
 *  - না থাকলে গেটওয়ে থেকে সাইন করা guest টোকেন এনে ক্যাশ করা হয় (মেয়াদের আগে নবায়ন)।
 *  - 401 এলে guest টোকেন একবার নতুন করে আবার চেষ্টা; নিজের key বাতিল হলে guest দিয়ে
 *    চালিয়ে যায় আর `onUserKeyRejected` দিয়ে একবার জানায় — ব্যবহারকারীর কাজ থামে না।
 *
 * vscode মডিউল ইমপোর্ট নেই, তাই tsx দিয়ে সরাসরি টেস্ট করা যায়।
 */

export interface GatewayAuthOptions {
  gatewayUrl: string;
  apiKey?: string | null;
  /** Called (at most once per process) when a configured key is rejected with 401. */
  onUserKeyRejected?: (status: number) => void;
  fetchImpl?: typeof fetch;
}

interface CachedGuestToken {
  base: string;
  token: string;
  expiresAt: number;
}

const GUEST_ENDPOINT = '/api/v1/auth/guest';
const REFRESH_MARGIN_MS = 60_000;
let cachedGuest: CachedGuestToken | null = null;
let inFlight: Promise<string | null> | null = null;
let userKeyWarned = false;

const cleanBase = (url: string) => (url || '').trim().replace(/\/+$/, '');

/** A configured key that is really just a guest placeholder is treated as "no key". */
export function normalizeUserKey(apiKey?: string | null): string | null {
  const tok = (apiKey || '').trim();
  if (!tok) return null;
  const lower = tok.toLowerCase();
  if (lower === 'guest' || lower === 'demo' || lower === 'public-guest') return null;
  if (tok.startsWith('tok_guest_') || tok.startsWith('sk-supreme-guest')) return null;
  return tok;
}

export function resetGatewayAuthCache(): void {
  cachedGuest = null;
  inFlight = null;
  userKeyWarned = false;
}

export async function getGuestToken(
  gatewayUrl: string,
  opts: { forceRefresh?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<string | null> {
  const base = cleanBase(gatewayUrl);
  const doFetch = opts.fetchImpl || fetch;
  if (
    !opts.forceRefresh &&
    cachedGuest &&
    cachedGuest.base === base &&
    cachedGuest.expiresAt - REFRESH_MARGIN_MS > Date.now()
  ) {
    return cachedGuest.token;
  }
  if (!opts.forceRefresh && inFlight) return inFlight;

  const request = (async (): Promise<string | null> => {
    try {
      const res = await doFetch(base + GUEST_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'X-SupremeAI-Platform': 'vsix' },
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as {
        access_token?: unknown;
        token?: unknown;
        expires_in?: unknown;
      } | null;
      const raw =
        typeof data?.access_token === 'string'
          ? data.access_token
          : typeof data?.token === 'string'
            ? data.token
            : '';
      const token = raw.trim();
      if (!token) return null;
      const ttlSeconds = Math.max(60, Number(data?.expires_in) || 3600);
      cachedGuest = { base, token, expiresAt: Date.now() + ttlSeconds * 1000 };
      return token;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  inFlight = request;
  return request;
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}`, 'X-SupremeAI-Key': token } : {};
}

/**
 * fetch() against the gateway with working auth. Never sends the literal "guest".
 * Retries once on 401 (fresh guest token, or guest fallback when the user key is rejected).
 */
export async function gatewayFetch(
  path: string,
  init: RequestInit & { headers?: Record<string, string> },
  opts: GatewayAuthOptions
): Promise<Response> {
  const base = cleanBase(opts.gatewayUrl);
  const doFetch = opts.fetchImpl || fetch;
  const url = /^https?:\/\//i.test(path) ? path : base + (path.startsWith('/') ? path : `/${path}`);
  const userKey = normalizeUserKey(opts.apiKey);

  const send = (token: string | null) =>
    doFetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        'X-SupremeAI-Platform': 'vsix',
        ...authHeaders(token),
      },
    });

  const firstToken = userKey || (await getGuestToken(base, { fetchImpl: doFetch }));
  const res = await send(firstToken);
  if (res.status !== 401) return res;

  if (userKey) {
    if (!userKeyWarned) {
      userKeyWarned = true;
      opts.onUserKeyRejected?.(res.status);
    }
    const guest = await getGuestToken(base, { fetchImpl: doFetch });
    return guest ? send(guest) : res;
  }

  const fresh = await getGuestToken(base, { forceRefresh: true, fetchImpl: doFetch });
  return fresh && fresh !== firstToken ? send(fresh) : res;
}
