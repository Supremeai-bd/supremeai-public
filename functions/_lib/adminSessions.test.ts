import { describe, expect, it, vi } from 'vitest';
import {
  classifyClient,
  currentSessionId,
  groupSessions,
  handleAdminSessionsRoute,
} from './adminSessions';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  ADMIN_EMAILS: 'owner@x.com',
};

const U_SELF = '11111111-1111-4111-8111-111111111111';
const U_OTHER = '22222222-2222-4222-8222-222222222222';
const U_OWNER = '33333333-3333-4333-8333-333333333333';
const S_CUR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S_SELF2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S_OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const S_OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const S_DEAD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const ROWS = [
  {
    session_id: S_CUR,
    user_id: U_SELF,
    email: 'Admin@x.com',
    created_at: '2026-11-27T09:00:00Z',
    last_active_at: '2026-11-27T12:00:00Z',
    user_agent: 'python-httpx/0.28.1',
    ip: '10.0.0.1',
    aal: 'aal1',
    live: true,
  },
  {
    session_id: S_SELF2,
    user_id: U_SELF,
    email: 'admin@x.com',
    created_at: '2026-11-26T09:00:00Z',
    last_active_at: '2026-11-26T12:00:00Z',
    user_agent: CHROME_WIN,
    ip: '203.0.113.9',
    aal: 'aal2',
    live: true,
  },
  {
    session_id: S_OTHER,
    user_id: U_OTHER,
    email: 'user@x.com',
    created_at: '2026-11-27T08:00:00Z',
    last_active_at: '2026-11-27T13:00:00Z',
    user_agent: 'curl/8.5.0',
    ip: '1.2.3.4',
    aal: 'aal1',
    live: true,
  },
  {
    session_id: S_OWNER,
    user_id: U_OWNER,
    email: 'owner@x.com',
    created_at: '2026-11-27T08:00:00Z',
    last_active_at: '2026-11-27T11:00:00Z',
    user_agent: null,
    ip: null,
    aal: 'aal1',
    live: true,
  },
  { session_id: S_DEAD, user_id: U_OTHER, email: 'user@x.com', live: false },
];

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

function fakeDb(revokeResult: unknown = 1) {
  const calls: { fn: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const fn = String(input).split('/rpc/')[1];
    calls.push({
      fn,
      body: JSON.parse(String(init?.body || '{}')),
      auth: new Headers(init?.headers).get('Authorization'),
    });
    if (fn === 'admin_list_auth_sessions') return Response.json(ROWS);
    if (fn === 'admin_revoke_auth_sessions') return Response.json(revokeResult);
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function call(
  path: string,
  method: string,
  body?: unknown,
  actor = 'admin@x.com',
  env: Record<string, string> = ENV
) {
  const { fetchImpl, calls } = fakeDb();
  const audit: { actor: string; details?: string } = { actor };
  const res = await handleAdminSessionsRoute(
    path,
    new Request(`https://studio.test${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt({ session_id: S_CUR })}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    audit,
    fetchImpl
  );
  return { res, json: res ? ((await res.json()) as Record<string, any>) : null, calls, audit };
}

describe('classifyClient', () => {
  it('labels server-made, CLI and browser sign-ins', () => {
    expect(classifyClient('python-httpx/0.28.1')).toEqual({
      client: 'studio-server',
      device: null,
    });
    expect(classifyClient('curl/8.5.0').client).toBe('cli');
    expect(classifyClient(CHROME_WIN)).toEqual({ client: 'browser', device: 'Chrome · Windows' });
    expect(classifyClient(null).client).toBe('unknown');
  });
});

describe('currentSessionId', () => {
  it('reads the session_id claim and ignores junk', () => {
    const req = (auth: string) =>
      new Request('https://x.test', { headers: { Authorization: auth } });
    expect(currentSessionId(req(`Bearer ${jwt({ session_id: S_CUR })}`))).toBe(S_CUR);
    expect(currentSessionId(req('Bearer not-a-jwt'))).toBeNull();
    expect(currentSessionId(req(`Bearer ${jwt({ session_id: 'x' })}`))).toBeNull();
  });
});

describe('groupSessions', () => {
  it('groups live sessions per user, hides server IPs and counts dead ones', () => {
    const { users, summary } = groupSessions(ROWS, {
      owners: new Set(['owner@x.com']),
      actor: 'admin@x.com',
      currentSessionId: S_CUR,
    });
    expect(summary).toEqual({ liveSessions: 4, usersOnline: 3, pendingCleanup: 1 });
    expect(users[0]).toMatchObject({ userId: U_SELF, isSelf: true, isOwner: false });
    const [server, browser] = users[0].sessions;
    expect(server).toMatchObject({ current: true, client: 'studio-server', ip: null });
    expect(browser).toMatchObject({ device: 'Chrome · Windows', ip: '203.0.113.9', mfa: true });
    expect(users.find((u) => u.userId === U_OWNER)?.isOwner).toBe(true);
  });
});

describe('GET /api/admin/sessions', () => {
  it('lists sessions via the service-role RPC', async () => {
    const { res, json, calls } = await call('/api/admin/sessions', 'GET');
    expect(res!.status).toBe(200);
    expect(calls[0]).toMatchObject({ fn: 'admin_list_auth_sessions', auth: 'Bearer svc' });
    expect(json!.summary.liveSessions).toBe(4);
  });

  it('503s when Supabase is not linked and ignores other paths', async () => {
    const { res } = await call('/api/admin/sessions', 'GET', undefined, 'a', {} as never);
    expect(res!.status).toBe(503);
    expect((await call('/api/admin/other', 'GET')).res).toBeNull();
  });
});

describe('POST /api/admin/sessions/revoke', () => {
  it('signs out one session of another user and audits it', async () => {
    const { res, calls, audit } = await call('/api/admin/sessions/revoke', 'POST', {
      userId: U_OTHER,
      sessionId: S_OTHER,
    });
    expect(res!.status).toBe(200);
    expect(calls[1]).toMatchObject({
      fn: 'admin_revoke_auth_sessions',
      body: { p_user_id: U_OTHER, p_session_id: S_OTHER },
    });
    expect(audit.details).toBe('signed out 1 session of user@x.com');
  });

  it('allows signing out your other devices but never the current one', async () => {
    expect(
      (await call('/api/admin/sessions/revoke', 'POST', { userId: U_SELF, sessionId: S_SELF2 }))
        .res!.status
    ).toBe(200);
    expect(
      (await call('/api/admin/sessions/revoke', 'POST', { userId: U_SELF, sessionId: S_CUR })).res!
        .status
    ).toBe(409);
    expect((await call('/api/admin/sessions/revoke', 'POST', { userId: U_SELF })).res!.status).toBe(
      409
    );
  });

  it('protects owners from non-owner admins', async () => {
    const asAdmin = await call('/api/admin/sessions/revoke', 'POST', { userId: U_OWNER });
    expect(asAdmin.res!.status).toBe(409);
    const asOwner = await call(
      '/api/admin/sessions/revoke',
      'POST',
      { userId: U_OWNER },
      'owner@x.com'
    );
    expect(asOwner.res!.status).toBe(200);
  });

  it('validates ids and unknown sessions', async () => {
    expect((await call('/api/admin/sessions/revoke', 'POST', { userId: 'x' })).res!.status).toBe(
      400
    );
    expect(
      (
        await call('/api/admin/sessions/revoke', 'POST', {
          userId: U_OTHER,
          sessionId: S_DEAD,
        })
      ).res!.status
    ).toBe(404);
  });
});
