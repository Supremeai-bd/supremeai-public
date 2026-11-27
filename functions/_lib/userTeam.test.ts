import { describe, expect, it, vi } from 'vitest';
import { MAX_SEATS, handleUserTeamRequest, mapRoster, statusForDbError } from './userTeam';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

const ROSTER = {
  owner: { id: ME, email: 'me@x.com', name: null, createdAt: '2026-11-01T10:00:00Z', mfa: true },
  members: [
    {
      id: MEMBER,
      email: 'dev@x.com',
      name: 'Dev Person',
      role: 'Reviewer',
      invitedAt: '2026-11-20T10:00:00Z',
      active: true,
      mfa: false,
    },
  ],
};

const signedIn = async () => ({ valid: true, isGuest: false, user_id: ME, email: 'me@x.com' });

type Call = { url: string; method: string; body: any; prefer: string | null };

function fakeDb(handlers: Record<string, (call: Call) => [number, unknown]> = {}) {
  const calls: Call[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    const call: Call = {
      url,
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
      prefer: headers.Prefer || null,
    };
    calls.push(call);
    const path = url.replace('https://db.test/rest/v1/', '');
    const key = Object.keys(handlers).find((k) => path.startsWith(k));
    const [status, data] = key ? handlers[key](call) : [200, ROSTER];
    return new Response(JSON.stringify(data), { status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const req = (path: string, method = 'GET', body?: unknown) =>
  new Request(`https://app.test/api/user/team${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('mapRoster', () => {
  it('puts the owner first and maps members to the UI shape', () => {
    const out = mapRoster(ROSTER);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      id: ME,
      role: 'Owner',
      name: 'Me',
      avatar: 'M',
      joinedDate: '2026-11-01',
      twoFactorEnabled: true,
      status: 'active',
    });
    expect(out[1]).toMatchObject({
      id: MEMBER,
      name: 'Dev Person',
      role: 'Reviewer',
      status: 'active',
      joinedDate: '2026-11-20',
    });
  });

  it('treats unconfirmed members as invited and unknown roles as Viewer', () => {
    const out = mapRoster({
      members: [{ id: 'x', email: 'a@b.co', role: 'Admin', active: false }],
    });
    expect(out[0]).toMatchObject({ role: 'Viewer', status: 'invited', name: 'A' });
  });
});

describe('statusForDbError', () => {
  it('maps team RPC errcodes', () => {
    expect(statusForDbError({ code: '42501' }, 403)).toBe(403);
    expect(statusForDbError({ code: '22023' }, 400)).toBe(400);
    expect(statusForDbError({ code: '54000' }, 500)).toBe(429);
    expect(statusForDbError({ code: 'XX000' }, 500)).toBe(502);
    expect(statusForDbError(null, 0)).toBe(502);
  });
});

describe('handleUserTeamRequest — auth', () => {
  it('rejects guests and invalid sessions with 401', async () => {
    const { impl, calls } = fakeDb();
    for (const verify of [
      async () => ({ valid: false, isGuest: false }),
      async () => ({ valid: true, isGuest: true, user_id: ME }),
    ]) {
      const res = await handleUserTeamRequest(req(''), ENV, { verify, fetchImpl: impl });
      expect(res.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it('answers 403 (not 401) for a valid session without a Supabase user id, so the client keeps the session', async () => {
    const { impl, calls } = fakeDb();
    const verify = async () => ({ valid: true, isGuest: false, user_id: 'api-key-user' });
    const res = await handleUserTeamRequest(req(''), ENV, { verify, fetchImpl: impl });
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('answers 503 when the session check itself is unavailable', async () => {
    const { impl, calls } = fakeDb();
    const verify = async () => ({ valid: false, isGuest: false, unavailable: true, status: 503 });
    const res = await handleUserTeamRequest(req(''), ENV, { verify, fetchImpl: impl });
    expect(res.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('returns 503 when Supabase is not linked', async () => {
    const res = await handleUserTeamRequest(req(''), {}, { verify: signedIn });
    expect(res.status).toBe(503);
  });
});

describe('handleUserTeamRequest — roster', () => {
  it('GET reads the caller roster via the service-role RPC', async () => {
    const { impl, calls } = fakeDb();
    const res = await handleUserTeamRequest(req(''), ENV, { verify: signedIn, fetchImpl: impl });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.maxSeats).toBe(MAX_SEATS);
    expect(body.members.map((m: any) => m.role)).toEqual(['Owner', 'Reviewer']);
    expect(calls[0].url).toBe('https://db.test/rest/v1/rpc/team_roster');
    expect(calls[0].body).toEqual({ p_owner: ME });
  });

  it('POST upserts the invite with the name and owner = caller', async () => {
    const { impl, calls } = fakeDb({ 'team_members?': () => [201, [{}]] });
    const res = await handleUserTeamRequest(
      req('', 'POST', { email: ' Dev@X.com ', name: 'Dev Person', role: 'Reviewer' }),
      ENV,
      { verify: signedIn, fetchImpl: impl }
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.member.email).toBe('dev@x.com');
    const insert = calls.find((c) => c.url.includes('team_members?'))!;
    expect(insert.url).toContain('on_conflict=team_owner_id,email');
    expect(insert.prefer).toContain('merge-duplicates');
    expect(insert.body).toEqual({
      team_owner_id: ME,
      email: 'dev@x.com',
      role: 'Reviewer',
      display_name: 'Dev Person',
    });
  });

  it('POST rejects bad email, Owner role, self-invite and a full team', async () => {
    const { impl } = fakeDb();
    const deps = { verify: signedIn, fetchImpl: impl };
    const bad = [
      { email: 'nope', role: 'Viewer' },
      { email: 'a@b.co', role: 'Owner' },
      { email: 'ME@x.com', role: 'Viewer' },
    ];
    for (const body of bad) {
      expect((await handleUserTeamRequest(req('', 'POST', body), ENV, deps)).status).toBe(400);
    }
    const full = {
      owner: ROSTER.owner,
      members: Array.from({ length: MAX_SEATS - 1 }, (_, i) => ({
        id: `m${i}`,
        email: `u${i}@x.com`,
        role: 'Viewer',
      })),
    };
    const fullDb = fakeDb({ 'rpc/team_roster': () => [200, full] });
    const res = await handleUserTeamRequest(
      req('', 'POST', { email: 'new@x.com', role: 'Viewer' }),
      ENV,
      { verify: signedIn, fetchImpl: fullDb.impl }
    );
    expect(res.status).toBe(409);
    // Re-inviting an existing member (role change) is still allowed at the limit.
    const again = await handleUserTeamRequest(
      req('', 'POST', { email: 'u1@x.com', role: 'Developer' }),
      ENV,
      {
        verify: signedIn,
        fetchImpl: fakeDb({
          'rpc/team_roster': () => [200, full],
          'team_members?': () => [201, [{}]],
        }).impl,
      }
    );
    expect(again.status).toBe(200);
  });

  it('PATCH/DELETE are scoped to rows the caller owns', async () => {
    const { impl, calls } = fakeDb({ 'team_members?': () => [200, [{ id: MEMBER }]] });
    const deps = { verify: signedIn, fetchImpl: impl };
    expect(
      (await handleUserTeamRequest(req(`/${MEMBER}`, 'PATCH', { role: 'Viewer' }), ENV, deps))
        .status
    ).toBe(200);
    expect((await handleUserTeamRequest(req(`/${MEMBER}`, 'DELETE'), ENV, deps)).status).toBe(200);
    const writes = calls.filter((c) => c.url.includes('team_members?'));
    expect(writes.map((c) => c.method)).toEqual(['PATCH', 'DELETE']);
    for (const w of writes) {
      expect(w.url).toContain(`id=eq.${MEMBER}`);
      expect(w.url).toContain(`team_owner_id=eq.${ME}`);
    }
    expect(writes[0].body).toEqual({ role: 'Viewer' });
  });

  it('PATCH returns 404 for someone else’s member and 400 for Owner role', async () => {
    const { impl } = fakeDb({ 'team_members?': () => [200, []] });
    const deps = { verify: signedIn, fetchImpl: impl };
    expect(
      (await handleUserTeamRequest(req(`/${MEMBER}`, 'PATCH', { role: 'Viewer' }), ENV, deps))
        .status
    ).toBe(404);
    expect(
      (await handleUserTeamRequest(req(`/${MEMBER}`, 'PATCH', { role: 'Owner' }), ENV, deps)).status
    ).toBe(400);
    expect((await handleUserTeamRequest(req('/mem_123', 'DELETE'), ENV, deps)).status).toBe(404);
  });
});

describe('handleUserTeamRequest — chat', () => {
  it('GET /chat lists rooms for the caller', async () => {
    const rooms = [{ ownerId: OTHER_OWNER, myRole: 'Developer', memberCount: 3 }];
    const { impl, calls } = fakeDb({ 'rpc/team_chat_rooms': () => [200, rooms] });
    const res = await handleUserTeamRequest(req('/chat'), ENV, {
      verify: signedIn,
      fetchImpl: impl,
    });
    expect(((await res.json()) as any).rooms).toEqual(rooms);
    expect(calls[0].body).toEqual({ p_user: ME });
  });

  it('GET /chat/:owner passes the cursor and clamps limit', async () => {
    const { impl, calls } = fakeDb({
      'rpc/team_chat_messages': () => [200, { roomId: 'r1', messages: [{ id: 'm1' }] }],
    });
    const res = await handleUserTeamRequest(
      req(`/chat/${OTHER_OWNER}?after=2026-11-27T10:00:00.000Z&limit=999`),
      ENV,
      { verify: signedIn, fetchImpl: impl }
    );
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ roomId: 'r1', messages: [{ id: 'm1' }] });
    expect(calls[0].body).toEqual({
      p_user: ME,
      p_owner: OTHER_OWNER,
      p_after: '2026-11-27T10:00:00.000Z',
      p_limit: 200,
    });
  });

  it('maps non-member / rate-limit RPC errors', async () => {
    const forbidden = fakeDb({
      'rpc/team_chat_messages': () => [
        403,
        { code: '42501', message: 'not a member of this team' },
      ],
      'rpc/team_chat_post': () => [400, { code: '54000', message: 'too many messages, slow down' }],
    });
    const deps = { verify: signedIn, fetchImpl: forbidden.impl };
    const read = await handleUserTeamRequest(req(`/chat/${OTHER_OWNER}`), ENV, deps);
    expect(read.status).toBe(403);
    const post = await handleUserTeamRequest(
      req(`/chat/${OTHER_OWNER}`, 'POST', { content: 'hi' }),
      ENV,
      deps
    );
    expect(post.status).toBe(429);
    expect(((await post.json()) as any).error).toBe('too many messages, slow down');
  });

  it('POST validates content before calling the DB', async () => {
    const { impl, calls } = fakeDb({ 'rpc/team_chat_post': () => [200, { id: 'm9', mine: true }] });
    const deps = { verify: signedIn, fetchImpl: impl };
    expect(
      (
        await handleUserTeamRequest(
          req(`/chat/${OTHER_OWNER}`, 'POST', { content: '   ' }),
          ENV,
          deps
        )
      ).status
    ).toBe(400);
    expect(calls).toHaveLength(0);
    const ok = await handleUserTeamRequest(
      req(`/chat/${OTHER_OWNER}`, 'POST', { content: ' hi ' }),
      ENV,
      deps
    );
    expect(((await ok.json()) as any).message).toEqual({ id: 'm9', mine: true });
    expect(calls[0].body).toEqual({ p_user: ME, p_owner: OTHER_OWNER, p_content: 'hi' });
  });

  it('rejects malformed owner ids', async () => {
    const { impl } = fakeDb();
    const res = await handleUserTeamRequest(req('/chat/not-a-uuid'), ENV, {
      verify: signedIn,
      fetchImpl: impl,
    });
    expect(res.status).toBe(404);
  });
});
