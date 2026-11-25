import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SESSION_EXPIRED_EVENT, apiClient } from './apiClient';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const dispatchEvent = vi.fn();

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage());
  vi.stubGlobal('sessionStorage', makeStorage());
  vi.stubGlobal('window', {
    dispatchEvent,
    addEventListener: vi.fn(),
    location: { origin: 'http://localhost' },
  });
  localStorage.setItem('supremeai_access_token', 'stale-token');
  apiClient.registerRefreshHandler(null);
  dispatchEvent.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apiClient 401 recovery', () => {
  it('refreshes once and retries the request with the new token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'token expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const refresh = vi.fn().mockResolvedValue('fresh-token');
    apiClient.registerRefreshHandler(refresh);

    const result = await apiClient.get('/api/v1/protected');

    expect(result).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token');
  });

  it('does not loop when the retried request is also unauthorized', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'still unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const refresh = vi.fn().mockResolvedValue('fresh-token');
    apiClient.registerRefreshHandler(refresh);

    await expect(apiClient.get('/api/v1/protected')).rejects.toBeInstanceOf(ApiError);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect((dispatchEvent.mock.calls[0][0] as CustomEvent).type).toBe(SESSION_EXPIRED_EVENT);
  });

  it('emits the session-expired event when refresh fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'nope' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    apiClient.registerRefreshHandler(vi.fn().mockResolvedValue(null));

    await expect(apiClient.get('/api/v1/protected')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('never attempts a refresh for auth endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'bad credentials' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const refresh = vi.fn().mockResolvedValue('fresh-token');
    apiClient.registerRefreshHandler(refresh);

    await expect(
      apiClient.post('/api/v1/auth/login', { email: 'a@b.c', password: 'x' })
    ).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('shares a single refresh round-trip between concurrent 401s', async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      calls += 1;
      // first two calls are the original requests, the rest are retries
      return calls <= 2 ? jsonResponse({ detail: 'expired' }, 401) : jsonResponse({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const refresh = vi
      .fn()
      .mockImplementation(
        () => new Promise<string | null>((resolve) => setTimeout(() => resolve('fresh-token'), 10))
      );
    apiClient.registerRefreshHandler(refresh);

    const [a, b] = await Promise.all([apiClient.get('/api/v1/one'), apiClient.get('/api/v1/two')]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('skips auth entirely when skipAuth is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockResolvedValue('fresh-token');
    apiClient.registerRefreshHandler(refresh);

    await apiClient.get('/api/public/config', { skipAuth: true });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('never emits session-expired for admin elevation endpoints on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'Admin passkey required' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockResolvedValue('fresh-token');
    apiClient.registerRefreshHandler(refresh);

    await expect(apiClient.get('/api/admin/customers')).rejects.toMatchObject({ status: 401 });

    expect(refresh).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('never emits session-expired when skipSessionExpiry is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockResolvedValue(null);
    apiClient.registerRefreshHandler(refresh);

    await expect(
      apiClient.get('/api/billing/invoices', { skipSessionExpiry: true })
    ).rejects.toMatchObject({
      status: 401,
    });

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('never emits session-expired when user has no stored token', async () => {
    localStorage.removeItem('supremeai_access_token');
    localStorage.removeItem('supremeai_auth_user');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockResolvedValue(null);
    apiClient.registerRefreshHandler(refresh);

    await expect(apiClient.get('/api/v1/protected')).rejects.toMatchObject({ status: 401 });

    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('apiClient transient retry (pattern audit P3.1)', () => {
  beforeEach(() => {
    apiClient.registerRefreshHandler(null);
  });

  it('retries a GET on 503 and succeeds on the next attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ detail: 'cold start' }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiClient.get('/api/v1/transient', { retryDelayMs: 1 });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the default two extra attempts and surfaces the last status', async () => {
    // 504 (not 502/503) keeps the pre-existing Cloudflare direct-fallback
    // path out of the picture so fetch counts stay exact.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'still down' }, 504));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.get('/api/v1/flaky', { retryDelayMs: 1 })).rejects.toMatchObject({
      status: 504,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 primary + 2 retries
  });

  it('never retries non-idempotent methods by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'down' }, 504));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiClient.post('/api/v1/orders', { item: 1 }, { retryDelayMs: 1 })
    ).rejects.toMatchObject({ status: 504 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry 4xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'nope' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.get('/api/v1/missing', { retryDelayMs: 1 })).rejects.toMatchObject({
      status: 404,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honors an explicit retries: 0', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ detail: 'down' }, 504));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiClient.get('/api/v1/no-retry', { retries: 0, retryDelayMs: 1 })
    ).rejects.toMatchObject({ status: 504 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('apiClient GET single-flight dedup (pattern audit P3.1)', () => {
  beforeEach(() => {
    apiClient.registerRefreshHandler(null);
  });

  it('shares one network round trip between concurrent identical GETs', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(jsonResponse({ n: 1 })), 5)
          ) as Promise<Response>
      );
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      apiClient.get('/api/v1/dedupe-probe'),
      apiClient.get('/api/v1/dedupe-probe'),
    ]);

    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('issues separate requests when skipDedup is set', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(jsonResponse({ ok: true })), 5)
          ) as Promise<Response>
      );
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      apiClient.get('/api/v1/poll', { skipDedup: true }),
      apiClient.get('/api/v1/poll', { skipDedup: true }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('apiClient abort semantics (pattern audit P3.1)', () => {
  beforeEach(() => {
    apiClient.registerRefreshHandler(null);
  });

  it('rethrows a caller-initiated abort instead of faking a timeout', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = apiClient.get('/api/v1/long', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still maps its own timeout to the 408 ApiError', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiClient.get('/api/v1/hang', { timeoutMs: 20 })).rejects.toMatchObject({
      status: 408,
    });
  });
});
