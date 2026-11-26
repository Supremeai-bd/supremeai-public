// @vitest-environment node
// বাংলা মন্তব্য: Cloudflare adapter — CORS preflight/allowlist আর Pages Function ফাইলগুলোর wiring
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestViaHono } from './honoAdapter';
import { onRequest as releasesOnRequest } from '../api/releases/latest';
import { onRequest as clientErrorOnRequest } from '../api/telemetry/client-error';

const ORIGIN = 'https://supremeai-studio.pages.dev';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('onRequestViaHono (Cloudflare Pages adapter)', () => {
  it('answers CORS preflight without touching the handler', async () => {
    const res = await onRequestViaHono({
      request: new Request(`${ORIGIN}/api/telemetry/client-error`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
      env: {},
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  it('adds allowlisted CORS headers and keeps handler headers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await clientErrorOnRequest({
      request: new Request(`${ORIGIN}/api/telemetry/client-error`, {
        method: 'POST',
        headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'edge' }),
      }),
      env: {},
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('never reflects an origin that is not on the allowlist', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await clientErrorOnRequest({
      request: new Request(`${ORIGIN}/api/telemetry/client-error`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: '{}',
      }),
      env: {},
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('passes Pages env bindings through to handlers (GITHUB_READONLY_TOKEN)', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await releasesOnRequest({
      request: new Request(`${ORIGIN}/api/releases/latest`),
      env: { GITHUB_READONLY_TOKEN: 'edge-token' },
    });
    expect(res.status).toBe(200);
    const restCall = (fetchMock.mock.calls as unknown as Array<[string, RequestInit?]>).find(
      ([u]) => String(u).includes('api.github.com')
    );
    expect((restCall?.[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer edge-token'
    );
  });
});
