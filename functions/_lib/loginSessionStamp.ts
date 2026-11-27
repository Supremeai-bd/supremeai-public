/**
 * বাংলা মন্তব্য: লগইন সেশনে আসল ডিভাইস ও IP বসানো।
 *
 * লগইন/সাইন-আপ core (Render) থেকে Supabase-এ যায়, তাই `auth.sessions`-এ core-এর
 * "python-httpx" UA আর Render-এর IP লেখা হতো — Admin → Sessions পেজে সব লগইন একই রকম দেখাত।
 * এজ আসল ব্রাউজার UA আর `cf-connecting-ip` দেখে; সফল লগইনের পরে ব্যাকগ্রাউন্ডে
 * `stamp_login_session` RPC ডেকে ওই ইউজারের সবচেয়ে নতুন (২ মিনিটের মধ্যে, এখনো
 * stamp-না-করা) সেশনে সেটা বসিয়ে দেয়। ব্রাউজার নিজে কিছু পাঠায় না, তাই জাল করা যায় না।
 * কোনো ভুল হলে চুপচাপ বাদ — লগইন কখনো আটকায় না।
 */

import { resolveSupabaseAdmin } from './adminRealData';

type Env = Record<string, string | undefined> | undefined;

const LOGIN_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/auth/login',
  '/api/auth/register',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLoginSessionRoute(method: string, pathname: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return LOGIN_PATHS.has(normalized);
}

/** `user_id` (core TokenResponse) or `user.id`; only real Supabase UUIDs. */
export function extractLoginUserId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const user = (b.user && typeof b.user === 'object' ? b.user : {}) as Record<string, unknown>;
  const id = String(b.user_id || user.id || '');
  return UUID_RE.test(id) ? id : null;
}

export async function stampLoginSession(
  env: Env,
  request: Request,
  upstreamResponse: Response,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const cfg = resolveSupabaseAdmin(env);
    if (!cfg || !upstreamResponse.ok) return false;
    const userId = extractLoginUserId(await upstreamResponse.json().catch(() => null));
    if (!userId) return false;
    const userAgent = (request.headers.get('user-agent') || '').slice(0, 512);
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (!userAgent && !ip) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/stamp_login_session`, {
        method: 'POST',
        headers: {
          apikey: cfg.key,
          Authorization: `Bearer ${cfg.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ p_user: userId, p_user_agent: userAgent, p_ip: ip }),
        signal: controller.signal,
      });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
