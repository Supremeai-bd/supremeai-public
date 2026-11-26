// @vitest-environment node
// বাংলা মন্তব্য: verifyUpstreamSession-এর দুটি রিগ্রেশন পিন করে —
// (১) `Bearer test-user-session` বাইপাস প্রোডাকশনে কাজ করবে না (লাইভে browser-proxy খুলে দিত),
// (২) session-verify cache সীমাবদ্ধ থাকে (আগে cleanup কোড return-এর পরে unreachable ছিল)।
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
