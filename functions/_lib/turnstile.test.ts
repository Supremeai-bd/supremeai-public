// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enforceAuthCaptcha,
  isCaptchaProtectedAuthRoute,
  isEmbeddedClientOrigin,
  TURNSTILE_TOKEN_HEADER,
  TURNSTILE_VERIFY_URL,
  verifyTurnstileToken,
} from './turnstile';
import { onRequest as proxyOnRequest } from '../api/[[path]]';

const SECRET_ENV = { TURNSTILE_SECRET_KEY: 'test-secret' };

function loginRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://studio.example/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email: 'a@b.co', password: 'x' }),
  });
}

function siteverifyFetch(success: boolean) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ success }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  );
}

describe('turnstile route matching', () => {
  it('protects only POST login/register routes', () => {
    expect(isCaptchaProtectedAuthRoute('POST', '/api/v1/auth/login')).toBe(true);
    expect(isCaptchaProtectedAuthRoute('post', '/api/v1/auth/register/')).toBe(true);
    expect(isCaptchaProtectedAuthRoute('POST', '/api/auth/login')).toBe(true);
    expect(isCaptchaProtectedAuthRoute('GET', '/api/v1/auth/login')).toBe(false);
    expect(isCaptchaProtectedAuthRoute('POST', '/api/v1/auth/refresh')).toBe(false);
    expect(isCaptchaProtectedAuthRoute('POST', '/api/v1/auth/guest')).toBe(false);
  });

  it('recognises desktop, mobile and VS Code origins only', () => {
    expect(isEmbeddedClientOrigin('tauri://localhost')).toBe(true);
    expect(isEmbeddedClientOrigin('http://tauri.localhost')).toBe(true);
    expect(isEmbeddedClientOrigin('vscode-webview://abc123')).toBe(true);
    expect(isEmbeddedClientOrigin('capacitor://localhost')).toBe(true);
    expect(isEmbeddedClientOrigin('https://supremeai-studio.pages.dev')).toBe(false);
    expect(isEmbeddedClientOrigin('https://tauri.localhost.evil.example')).toBe(false);
    expect(isEmbeddedClientOrigin(null)).toBe(false);
    expect(isEmbeddedClientOrigin('not a url')).toBe(false);
  });
});

describe('verifyTurnstileToken', () => {
  it('posts secret, token and IP to siteverify and accepts success=true', async () => {
    const fetchImpl = siteverifyFetch(true);
    await expect(verifyTurnstileToken('tok', 'sec', '1.2.3.4', fetchImpl)).resolves.toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('secret')).toBe('sec');
    expect(form.get('response')).toBe('tok');
    expect(form.get('remoteip')).toBe('1.2.3.4');
  });

  it('rejects success=false, HTTP errors and network failures', async () => {
    await expect(verifyTurnstileToken('tok', 'sec', null, siteverifyFetch(false))).resolves.toBe(
      false
    );
    const httpError = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(verifyTurnstileToken('tok', 'sec', null, httpError)).resolves.toBe(false);
    const thrown = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(verifyTurnstileToken('tok', 'sec', null, thrown)).resolves.toBe(false);
    await expect(verifyTurnstileToken('', 'sec', null, siteverifyFetch(true))).resolves.toBe(false);
  });
});

describe('enforceAuthCaptcha', () => {
  it('is a no-op when TURNSTILE_SECRET_KEY is not configured', async () => {
    const fetchImpl = siteverifyFetch(false);
    const result = await enforceAuthCaptcha(
      loginRequest(),
      '/api/v1/auth/login',
      {},
      new Headers(),
      fetchImpl
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a web login without a token with 403 CAPTCHA_FAILED', async () => {
    const result = await enforceAuthCaptcha(
      loginRequest({ Origin: 'https://supremeai-studio.pages.dev' }),
      '/api/v1/auth/login',
      SECRET_ENV,
      new Headers(),
      siteverifyFetch(true)
    );
    expect(result?.status).toBe(403);
    await expect(result?.json()).resolves.toMatchObject({ code: 'CAPTCHA_FAILED' });
  });

  it('rejects an invalid token and accepts a valid one, stripping the header', async () => {
    const forwardHeaders = new Headers({ [TURNSTILE_TOKEN_HEADER]: 'tok' });
    const bad = await enforceAuthCaptcha(
      loginRequest({ [TURNSTILE_TOKEN_HEADER]: 'tok' }),
      '/api/v1/auth/login',
      SECRET_ENV,
      forwardHeaders,
      siteverifyFetch(false)
    );
    expect(bad?.status).toBe(403);
    expect(forwardHeaders.has(TURNSTILE_TOKEN_HEADER)).toBe(false);

    const good = await enforceAuthCaptcha(
      loginRequest({ [TURNSTILE_TOKEN_HEADER]: 'tok' }),
      '/api/v1/auth/login',
      SECRET_ENV,
      new Headers(),
      siteverifyFetch(true)
    );
    expect(good).toBeNull();
  });

  it('lets embedded desktop/VS Code clients through without a token', async () => {
    const fetchImpl = siteverifyFetch(false);
    const result = await enforceAuthCaptcha(
      loginRequest({ Origin: 'tauri://localhost' }),
      '/api/v1/auth/login',
      SECRET_ENV,
      new Headers(),
      fetchImpl
    );
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never gates non-auth routes', async () => {
    const result = await enforceAuthCaptcha(
      new Request('https://studio.example/api/v1/stream/chat', { method: 'POST' }),
      '/api/v1/stream/chat',
      SECRET_ENV,
      new Headers(),
      siteverifyFetch(false)
    );
    expect(result).toBeNull();
  });
});

describe('same-origin /api proxy captcha wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks login before contacting the backend when the token is missing', async () => {
    const upstream = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const response = await proxyOnRequest({
      request: loginRequest({ Origin: 'https://studio.example' }),
      env: SECRET_ENV,
    });
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('forwards login to the backend after a valid token, without the token header', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        if (input === TURNSTILE_VERIFY_URL) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        seen.push({ url: input, headers: new Headers(init?.headers) });
        return new Response(JSON.stringify({ access_token: 't' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    const response = await proxyOnRequest({
      request: loginRequest({ Origin: 'https://studio.example', [TURNSTILE_TOKEN_HEADER]: 'ok' }),
      env: SECRET_ENV,
    });
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).pathname).toBe('/api/v1/auth/login');
    expect(seen[0].headers.has(TURNSTILE_TOKEN_HEADER)).toBe(false);
  });
});

describe('/api/auth/captcha-config', () => {
  it('reports disabled until both Turnstile keys are configured', async () => {
    const { onRequest } = await import('../api/auth/captcha-config');
    const req = () => new Request('https://studio.example/api/auth/captcha-config');

    const none = await onRequest({ request: req(), env: {} });
    await expect(none.json()).resolves.toMatchObject({ enabled: false, siteKey: '' });

    const siteOnly = await onRequest({ request: req(), env: { TURNSTILE_SITE_KEY: '0xSITE' } });
    await expect(siteOnly.json()).resolves.toMatchObject({ enabled: false, siteKey: '' });

    const both = await onRequest({
      request: req(),
      env: { TURNSTILE_SITE_KEY: '0xSITE', TURNSTILE_SECRET_KEY: 'sec' },
    });
    expect(both.status).toBe(200);
    await expect(both.json()).resolves.toMatchObject({ enabled: true, siteKey: '0xSITE' });
  });
});
