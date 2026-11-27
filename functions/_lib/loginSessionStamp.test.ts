import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractLoginUserId, isLoginSessionRoute, stampLoginSession } from './loginSessionStamp';
import { onRequest as proxyOnRequest } from '../api/[[path]]';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const UID = '11111111-1111-4111-8111-111111111111';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36';

const loginReq = (path = '/api/v1/auth/login') =>
  new Request(`https://app.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': CHROME,
      'CF-Connecting-IP': '203.0.113.7',
    },
    body: JSON.stringify({ username: 'a@b.co', password: 'x' }),
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isLoginSessionRoute / extractLoginUserId', () => {
  it('matches only POST login/register', () => {
    expect(isLoginSessionRoute('POST', '/api/v1/auth/login')).toBe(true);
    expect(isLoginSessionRoute('post', '/api/v1/auth/register/')).toBe(true);
    expect(isLoginSessionRoute('GET', '/api/v1/auth/login')).toBe(false);
    expect(isLoginSessionRoute('POST', '/api/v1/auth/refresh')).toBe(false);
  });

  it('reads user_id or user.id and rejects non-UUIDs', () => {
    expect(extractLoginUserId({ user_id: UID })).toBe(UID);
    expect(extractLoginUserId({ user: { id: UID } })).toBe(UID);
    expect(extractLoginUserId({ user_id: 'admin_rbac' })).toBeNull();
    expect(extractLoginUserId(null)).toBeNull();
  });
});

describe('stampLoginSession', () => {
  it('sends the real browser UA and edge IP to the service-role RPC', async () => {
    const fetchImpl = vi.fn(async () => json('sess-id'));
    const ok = await stampLoginSession(
      ENV,
      loginReq(),
      json({ user_id: UID }),
      fetchImpl as unknown as typeof fetch
    );
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://db.test/rest/v1/rpc/stamp_login_session');
    expect(JSON.parse(String(init.body))).toEqual({
      p_user: UID,
      p_user_agent: CHROME,
      p_ip: '203.0.113.7',
    });
  });

  it('does nothing without Supabase, on failed logins, or without a user id', async () => {
    const fetchImpl = vi.fn(async () => json(null));
    const f = fetchImpl as unknown as typeof fetch;
    expect(await stampLoginSession({}, loginReq(), json({ user_id: UID }), f)).toBe(false);
    expect(await stampLoginSession(ENV, loginReq(), json({ detail: 'no' }, 401), f)).toBe(false);
    expect(await stampLoginSession(ENV, loginReq(), json({ token: 't' }), f)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws when the RPC call fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    await expect(
      stampLoginSession(
        ENV,
        loginReq(),
        json({ user_id: UID }),
        fetchImpl as unknown as typeof fetch
      )
    ).resolves.toBe(false);
  });
});

describe('API proxy wiring', () => {
  it('stamps in the background after a successful login and still returns the body', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        return url.includes('/rest/v1/rpc/') ? json('sess') : json({ user_id: UID, token: 't' });
      })
    );
    const pending: Promise<unknown>[] = [];
    const res = await proxyOnRequest({
      request: loginReq(),
      env: ENV,
      waitUntil: (p) => pending.push(p),
    });
    expect(((await res.json()) as { user_id: string }).user_id).toBe(UID);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(calls.some((u) => u.endsWith('/rest/v1/rpc/stamp_login_session'))).toBe(true);
  });

  it('does not stamp for other routes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ user_id: UID }))
    );
    const pending: Promise<unknown>[] = [];
    await proxyOnRequest({
      request: new Request('https://app.test/api/v1/chat', { method: 'POST', body: '{}' }),
      env: ENV,
      waitUntil: (p) => pending.push(p),
    });
    expect(pending).toHaveLength(0);
  });
});
