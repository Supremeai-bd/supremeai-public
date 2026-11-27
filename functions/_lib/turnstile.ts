/**
 * Cloudflare Turnstile gate for the password auth routes (login / register).
 *
 * বাংলা: লগইন/সাইন-আপ রিকোয়েস্ট Render ব্যাকএন্ডে পাঠানোর আগে এজ-এ Turnstile
 * টোকেন যাচাই করা হয়। `TURNSTILE_SECRET_KEY` সেট না থাকলে গেট বন্ধ থাকে (আগের মতোই
 * চলে), তাই এনভ না বসানো পর্যন্ত কিছুই ভাঙবে না।
 *
 * Desktop (Tauri), mobile and VS Code webviews cannot render the widget (Turnstile
 * only runs on real http(s) hostnames), so requests from those embedded origins
 * without a token are let through; the backend and Supabase rate limits still apply.
 */

export const TURNSTILE_TOKEN_HEADER = 'X-Turnstile-Token';
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const CAPTCHA_PROTECTED_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/auth/login',
  '/api/auth/register',
]);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function isCaptchaProtectedAuthRoute(method: string, pathname: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return CAPTCHA_PROTECTED_PATHS.has(normalized);
}

/** True for the Origin values sent by the desktop, mobile and VS Code shells. */
export function isEmbeddedClientOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (
    protocol === 'tauri:' ||
    protocol === 'vscode-webview:' ||
    protocol === 'capacitor:' ||
    protocol === 'ionic:'
  ) {
    return true;
  }
  const hostname = parsed.hostname.toLowerCase();
  return hostname === 'tauri.localhost' || hostname.endsWith('.tauri.localhost');
}

export async function verifyTurnstileToken(
  token: string,
  secret: string,
  remoteIp: string | null,
  fetchImpl: FetchLike = fetch
): Promise<boolean> {
  if (!token || !secret) return false;
  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { success?: unknown } | null;
    return data?.success === true;
  } catch {
    // Fail closed: an unverifiable token is treated as invalid.
    return false;
  }
}

/**
 * Returns a 403 Response when the request must be rejected, or null to continue.
 * The token header is removed from `forwardHeaders` so it never reaches upstream.
 */
export async function enforceAuthCaptcha(
  request: Request,
  pathname: string,
  env: Record<string, string | undefined>,
  forwardHeaders: Headers,
  fetchImpl: FetchLike = fetch
): Promise<Response | null> {
  const token = (request.headers.get(TURNSTILE_TOKEN_HEADER) || '').trim();
  forwardHeaders.delete(TURNSTILE_TOKEN_HEADER);

  const secret = (env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret || !isCaptchaProtectedAuthRoute(request.method, pathname)) return null;

  if (!token && isEmbeddedClientOrigin(request.headers.get('Origin'))) return null;

  const ok = token
    ? await verifyTurnstileToken(token, secret, request.headers.get('cf-connecting-ip'), fetchImpl)
    : false;
  if (ok) return null;

  return new Response(
    JSON.stringify({
      error: 'Captcha verification failed. Please retry.',
      detail: 'Captcha verification failed. Please retry.',
      code: 'CAPTCHA_FAILED',
    }),
    {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    }
  );
}
