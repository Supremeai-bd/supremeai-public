/**
 * Cloudflare Turnstile helpers for the sign-in / sign-up form.
 *
 * বাংলা: এজ (`/api/auth/captcha-config`) থেকে পাবলিক site key আনা হয়। কী না থাকলে,
 * অথবা Desktop/Mobile/VS Code অ্যাপে (যেখানে Turnstile চলে না) widget দেখানো হয় না —
 * তখন লগইন আগের মতোই কাজ করে।
 */

import { env, isEmbeddedAppOrigin } from '../config/env';

export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TURNSTILE_TOKEN_HEADER = 'X-Turnstile-Token';

export interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
  theme?: 'auto' | 'light' | 'dark';
  appearance?: 'always' | 'execute' | 'interaction-only';
  size?: 'normal' | 'flexible' | 'compact';
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
  reset: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let siteKeyPromise: Promise<string> | null = null;
let scriptPromise: Promise<TurnstileApi> | null = null;

/** Turnstile only runs on real web hostnames, never in embedded shells or mock mode. */
export function isTurnstileSupportedHere(): boolean {
  if (typeof window === 'undefined') return false;
  if (env.isMockEnabled) return false;
  return !isEmbeddedAppOrigin();
}

export function fetchTurnstileSiteKey(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!isTurnstileSupportedHere()) return Promise.resolve('');
  if (!siteKeyPromise) {
    siteKeyPromise = fetchImpl('/api/auth/captcha-config', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then(async (res) => {
        if (!res.ok) return '';
        const data = (await res.json().catch(() => null)) as {
          enabled?: unknown;
          siteKey?: unknown;
        } | null;
        return data?.enabled === true && typeof data.siteKey === 'string' ? data.siteKey : '';
      })
      .catch(() => '');
  }
  return siteKeyPromise;
}

export function loadTurnstileScript(): Promise<TurnstileApi> {
  if (typeof window !== 'undefined' && window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error('Turnstile failed to initialise'));
      };
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('Turnstile script failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/** Request headers carrying the captcha token, or none when there is no token. */
export function captchaHeaders(token?: string | null): Record<string, string> {
  return token ? { [TURNSTILE_TOKEN_HEADER]: token } : {};
}

/** Test-only: clear cached promises. */
export function resetTurnstileCacheForTests(): void {
  siteKeyPromise = null;
  scriptPromise = null;
}
