// @vitest-environment node
// বাংলা মন্তব্য: প্রোডাকশনে test-token bypass বন্ধ, cache bounded, এবং
// origin/token/cookie context আলাদা থাকে; একই context শুধু TTL পর্যন্ত cache hit পায়।
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyUpstreamSession } from './edgeHelpers';

const UPSTREAM = 'https://upstream.example';

function requestWith(token: string): Request {
  return new Request('https://edge.example/api/workspace/browser-proxy', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('verifyUpstreamSession', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ email: 'user@example.com' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('does NOT accept the test bypass token outside the unit-test runtime', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));
    const result = await verifyUpstreamSession(requestWith('test-user-session'), UPSTREAM);
    expect(result.valid).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the canonical test bypass inside the unit-test runtime', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const result = await verifyUpstreamSession(requestWith('test-user-session'), UPSTREAM);
    expect(result.valid).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not reuse an accepted token verdict across upstreams', async () => {
    const request = requestWith('origin-isolation-token');
    await verifyUpstreamSession(request, UPSTREAM);
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));

    const result = await verifyUpstreamSession(request, 'https://other-upstream.example');

    expect(result.valid).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://other-upstream.example/api/v1/auth/me');
  });

  it('does not reuse a rejected token verdict across upstreams', async () => {
    const request = requestWith('negative-origin-isolation-token');
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 401 }));
    expect((await verifyUpstreamSession(request, UPSTREAM)).valid).toBe(false);

    const result = await verifyUpstreamSession(request, 'https://accepted-upstream.example');

    expect(result.valid).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('includes cookies in the context even when a bearer token is present', async () => {
    const token = 'mixed-credentials-isolation-token';
    const first = requestWith(token);
    first.headers.set('Cookie', 'session=first-user');
    await verifyUpstreamSession(first, UPSTREAM);
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));
    const second = requestWith(token);
    second.headers.set('Cookie', 'session=second-user');

    expect((await verifyUpstreamSession(second, UPSTREAM)).valid).toBe(false);
    expect((await verifyUpstreamSession(requestWith(token), UPSTREAM)).valid).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe('session=second-user');
    expect(fetchMock.mock.calls[2][1].headers.Cookie).toBeUndefined();
  });

  it('isolates cookie-only verdicts by upstream', async () => {
    const request = new Request('https://edge.example/api/workspace/browser-proxy', {
      headers: { Cookie: 'session=cookie-origin-isolation' },
    });
    await verifyUpstreamSession(request, UPSTREAM);
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));

    expect((await verifyUpstreamSession(request, 'https://cookie-upstream.example')).valid).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reuses an identical credential context until its TTL expires', async () => {
    const request = requestWith('context-ttl-token');
    request.headers.set('Cookie', 'session=stable-context');
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await verifyUpstreamSession(request, UPSTREAM);
      clock.mockReturnValue(now + 59_999);
      expect((await verifyUpstreamSession(request, UPSTREAM)).valid).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(now + 60_000);
      fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));
      expect((await verifyUpstreamSession(request, UPSTREAM)).valid).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });

  it('bounds the verify cache: the oldest entries are evicted once 5000 tokens are cached', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const first = 'bounded-cache-token-0';
    await verifyUpstreamSession(requestWith(first), UPSTREAM);
    // দ্বিতীয়বার একই টোকেন → cache hit, upstream কল হয় না
    await verifyUpstreamSession(requestWith(first), UPSTREAM);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 1; i <= 5000; i += 1) {
      await verifyUpstreamSession(requestWith(`bounded-cache-token-${i}`), UPSTREAM);
    }
    const callsBefore = fetchMock.mock.calls.length;
    // সীমা পেরোনোর পর প্রথম টোকেন evict হয়েছে → আবার upstream-এ যাচাই হয়
    await verifyUpstreamSession(requestWith(first), UPSTREAM);
    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
  });
});
