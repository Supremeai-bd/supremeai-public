import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captchaHeaders,
  fetchTurnstileSiteKey,
  loadTurnstileScript,
  resetTurnstileCacheForTests,
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_TOKEN_HEADER,
  type TurnstileApi,
} from './turnstile';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('turnstile helpers', () => {
  beforeEach(() => {
    resetTurnstileCacheForTests();
  });

  afterEach(() => {
    delete window.turnstile;
    document.head.querySelectorAll('script').forEach((el) => el.remove());
  });

  it('captchaHeaders only adds the header when a token exists', () => {
    expect(captchaHeaders('abc')).toEqual({ [TURNSTILE_TOKEN_HEADER]: 'abc' });
    expect(captchaHeaders(null)).toEqual({});
    expect(captchaHeaders('')).toEqual({});
  });

  it('returns the site key only when the edge reports Turnstile enabled', async () => {
    const enabled = vi.fn(async () => jsonResponse({ enabled: true, siteKey: '0xSITE' }));
    await expect(fetchTurnstileSiteKey(enabled as unknown as typeof fetch)).resolves.toBe('0xSITE');
    expect(enabled).toHaveBeenCalledWith('/api/auth/captcha-config', expect.any(Object));

    resetTurnstileCacheForTests();
    const disabled = vi.fn(async () => jsonResponse({ enabled: false, siteKey: '' }));
    await expect(fetchTurnstileSiteKey(disabled as unknown as typeof fetch)).resolves.toBe('');
  });

  it('falls back to disabled on 404 or network errors (old servers, local dev)', async () => {
    const notFound = vi.fn(async () => jsonResponse({ error: 'nope' }, 404));
    await expect(fetchTurnstileSiteKey(notFound as unknown as typeof fetch)).resolves.toBe('');

    resetTurnstileCacheForTests();
    const offline = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(fetchTurnstileSiteKey(offline as unknown as typeof fetch)).resolves.toBe('');
  });

  it('caches the site key lookup', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ enabled: true, siteKey: 'k' }));
    await fetchTurnstileSiteKey(fetchImpl as unknown as typeof fetch);
    await fetchTurnstileSiteKey(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('injects the explicit-render script once and resolves with window.turnstile', async () => {
    const pending = loadTurnstileScript();
    const again = loadTurnstileScript();
    const scripts = document.head.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].getAttribute('src')).toBe(TURNSTILE_SCRIPT_URL);

    const api: TurnstileApi = { render: vi.fn(() => 'w1'), remove: vi.fn(), reset: vi.fn() };
    window.turnstile = api;
    scripts[0].dispatchEvent(new Event('load'));
    await expect(pending).resolves.toBe(api);
    await expect(again).resolves.toBe(api);
  });
});
