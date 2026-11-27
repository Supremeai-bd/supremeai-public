import { describe, expect, it, vi } from 'vitest';
import { handleAdminTeamRoute, mapTeamMember, ownerEmails } from './adminTeam';

const ENV = {
  SUPABASE_URL: 'https://supa.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  ADMIN_EMAILS: 'owner@x.com',
};

const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const INVITED = '44444444-4444-4444-8444-444444444444';

const USERS = [
  {
    id: OWNER,
    email: 'owner@x.com',
    app_metadata: { provider: 'email' },
    email_confirmed_at: '2026-01-01',
    last_sign_in_at: '2026-11-01',
  },
  {
    id: ADMIN,
    email: 'ops@x.com',
    app_metadata: { role: 'admin' },
    email_confirmed_at: '2026-01-01',
    last_sign_in_at: '2026-11-02',
  },
  {
    id: USER,
    email: 'member@x.com',
    user_metadata: { full_name: 'Member One', role: 'admin' },
    app_metadata: {},
    email_confirmed_at: '2026-01-01',
    last_sign_in_at: '2026-11-03',
  },
  { id: INVITED, email: 'new@x.com', app_metadata: {} },
];

type Call = { url: string; method: string; body: unknown };

function fakeSupabase(users = USERS, overrides: Partial<Record<string, Response>> = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${method} ${new URL(url).pathname}`;
    if (overrides[key]) return overrides[key]!;
    if (key === 'GET /auth/v1/admin/users') return Response.json({ users });
    if (key === 'POST /auth/v1/invite') return Response.json({ id: INVITED, email: 'new@x.com' });
    if (method === 'PUT') return Response.json({ id: 'ok' });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function req(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://studio.test${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  opts: { actor?: string; users?: typeof USERS; env?: Record<string, string> } = {}
) {
  const { fetchImpl, calls } = fakeSupabase(opts.users);
  const audit: { actor: string; details?: string } = { actor: opts.actor ?? 'ops@x.com' };
  const res = await handleAdminTeamRoute(
    path,
    req(path, method, body),
    opts.env ?? ENV,
    audit,
    fetchImpl
  );
  return { res: res!, json: (await res!.json()) as Record<string, any>, calls, audit };
}

describe('mapTeamMember', () => {
  it('trusts only app_metadata / ADMIN_EMAILS for the role, never user_metadata', () => {
    const owners = ownerEmails(ENV);
    expect(mapTeamMember(USERS[2], owners, 'x').role).toBe('user');
    expect(mapTeamMember(USERS[1], owners, 'x').role).toBe('admin');
    const owner = mapTeamMember(USERS[0], owners, 'owner@x.com');
    expect(owner).toMatchObject({ role: 'admin', isOwner: true, isSelf: true });
  });

  it('derives invited / suspended status', () => {
    const owners = ownerEmails(ENV);
    expect(mapTeamMember(USERS[3], owners, 'x').status).toBe('invited');
    const banned = { ...USERS[2], banned_until: '2999-01-01T00:00:00Z' };
    expect(mapTeamMember(banned, owners, 'x').status).toBe('suspended');
  });
});

describe('GET /api/admin/team', () => {
  it('lists real users with a summary', async () => {
    const { res, json } = await call('/api/admin/team');
    expect(res.status).toBe(200);
    expect(json.summary).toEqual({ total: 4, admins: 2, users: 2, invited: 1, suspended: 0 });
    expect(json.members[0].role).toBe('admin');
  });

  it('is honest when Supabase is not linked', async () => {
    const { res } = await call('/api/admin/team', 'GET', undefined, { env: {} });
    expect(res.status).toBe(503);
  });

  it('ignores unrelated paths', async () => {
    const res = await handleAdminTeamRoute(
      '/api/admin/customers',
      req('/api/admin/customers'),
      ENV,
      { actor: 'x' }
    );
    expect(res).toBeNull();
  });
});

describe('PATCH /api/admin/team/:id/role', () => {
  it('writes app_metadata.role and records an audit detail', async () => {
    const { res, json, calls, audit } = await call(`/api/admin/team/${USER}/role`, 'PATCH', {
      role: 'admin',
    });
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, effective: 'next-login' });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.url).toBe(`https://supa.test/auth/v1/admin/users/${USER}`);
    expect(put.body).toEqual({ app_metadata: { role: 'admin' } });
    expect(audit.details).toBe('role user → admin for member@x.com');
  });

  it('refuses self, owner, bad roles, bad ids and unknown users', async () => {
    expect(
      (await call(`/api/admin/team/${ADMIN}/role`, 'PATCH', { role: 'user' })).res.status
    ).toBe(409);
    expect(
      (await call(`/api/admin/team/${OWNER}/role`, 'PATCH', { role: 'user' })).res.status
    ).toBe(409);
    expect(
      (await call(`/api/admin/team/${USER}/role`, 'PATCH', { role: 'master_admin' })).res.status
    ).toBe(400);
    expect((await call('/api/admin/team/../role', 'PATCH', { role: 'user' })).res.status).toBe(400);
    expect((await call('/api/admin/team/abc/role', 'PATCH', { role: 'user' })).res.status).toBe(
      400
    );
    const unknown = '55555555-5555-4555-8555-555555555555';
    expect(
      (await call(`/api/admin/team/${unknown}/role`, 'PATCH', { role: 'user' })).res.status
    ).toBe(404);
  });

  it('never removes the last active admin', async () => {
    const users = [USERS[1], USERS[2]]; // only ops@x.com is admin; no ADMIN_EMAILS owner
    const { res, json, calls } = await call(
      `/api/admin/team/${ADMIN}/role`,
      'PATCH',
      { role: 'user' },
      {
        actor: 'admin-key',
        users,
        env: { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'k' },
      }
    );
    expect(res.status).toBe(409);
    expect(json.error).toMatch(/last active admin/);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('POST /api/admin/team/:id/suspend', () => {
  it('bans and un-bans through Supabase', async () => {
    const on = await call(`/api/admin/team/${USER}/suspend`, 'POST', { suspended: true });
    expect(on.res.status).toBe(200);
    expect(on.calls.find((c) => c.method === 'PUT')!.body).toEqual({ ban_duration: '876000h' });
    expect(on.json.member.status).toBe('suspended');

    const off = await call(`/api/admin/team/${USER}/suspend`, 'POST', { suspended: false });
    expect(off.calls.find((c) => c.method === 'PUT')!.body).toEqual({ ban_duration: 'none' });
  });

  it('requires a boolean and the right method', async () => {
    expect(
      (await call(`/api/admin/team/${USER}/suspend`, 'POST', { suspended: 'yes' })).res.status
    ).toBe(400);
    expect(
      (await call(`/api/admin/team/${USER}/suspend`, 'PATCH', { suspended: true })).res.status
    ).toBe(405);
  });
});

describe('POST /api/admin/team/invite', () => {
  it('invites and applies the admin role when asked', async () => {
    const { res, calls, audit } = await call('/api/admin/team/invite', 'POST', {
      email: 'New@X.com',
      role: 'admin',
    });
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ email: 'new@x.com' });
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      app_metadata: { role: 'admin' },
    });
    expect(audit.details).toBe('invited new@x.com as admin');
  });

  it('validates email and role', async () => {
    expect((await call('/api/admin/team/invite', 'POST', { email: 'nope' })).res.status).toBe(400);
    expect(
      (await call('/api/admin/team/invite', 'POST', { email: 'a@b.co', role: 'root' })).res.status
    ).toBe(400);
  });
});
