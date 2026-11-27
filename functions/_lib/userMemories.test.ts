import { describe, expect, it, vi } from 'vitest';
import { handleUserMemoriesRequest, mapMemory, normalizeMemory } from './userMemories';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const USER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const MEM = '0b6f8f2e-6c55-4c8b-9a0e-3f3c2a1d9e11';
const ROW = {
  id: MEM,
  content: 'Lives in Comilla',
  kind: 'fact',
  source_type: 'chatgpt',
  source_ref: null,
  created_by: 'user',
  status: 'confirmed',
  created_at: '2026-11-27T18:00:00Z',
  updated_at: '2026-11-27T18:00:00Z',
};

type Call = { url: string; method: string; body: unknown };
const signedIn = async () => ({ valid: true, isGuest: false, user_id: USER, email: 'u@x.com' });

async function call(
  method: string,
  path: string,
  respond: (c: Call) => Response,
  opts: { body?: unknown; verify?: () => Promise<any>; env?: Record<string, string> } = {}
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const c = {
      url: String(input),
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    return respond(c);
  }) as unknown as typeof fetch;
  const res = await handleUserMemoriesRequest(
    new Request(`https://studio.test${path}`, {
      method,
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }),
    opts.env ?? ENV,
    { fetchImpl, verify: (opts.verify ?? signedIn) as never }
  );
  return { res, json: (await res.json()) as Record<string, any>, calls };
}

describe('userMemories helpers', () => {
  it('normalizes for duplicate detection', () => {
    expect(normalizeMemory('  Lives   in Comilla. ')).toBe('lives in comilla');
    expect(normalizeMemory('আমি ঢাকায় থাকি।')).toBe('আমি ঢাকায় থাকি');
  });
  it('maps rows to the client shape', () => {
    expect(mapMemory(ROW)).toMatchObject({ id: MEM, source: 'chatgpt', status: 'confirmed' });
    expect(mapMemory({ ...ROW, kind: 'weird', status: 'candidate' })).toMatchObject({
      kind: 'fact',
      status: 'candidate',
    });
  });
});

describe('auth', () => {
  it('guests get 401, a slow session check 503 (never a sign-out), RBAC-only 403', async () => {
    const none = () => Response.json([]);
    expect(
      (
        await call('GET', '/api/user/memories', none, {
          verify: async () => ({ valid: false, isGuest: true }),
        })
      ).res.status
    ).toBe(401);
    expect(
      (
        await call('GET', '/api/user/memories', none, {
          verify: async () => ({ valid: false, isGuest: false, unavailable: true }),
        })
      ).res.status
    ).toBe(503);
    expect(
      (
        await call('GET', '/api/user/memories', none, {
          verify: async () => ({ valid: true, isGuest: false, user_id: 'admin' }),
        })
      ).res.status
    ).toBe(403);
    expect((await call('GET', '/api/user/memories', none, { env: {} })).res.status).toBe(503);
  });
});

describe('GET /api/user/memories', () => {
  it('lists only my own memories', async () => {
    const { json, calls } = await call('GET', '/api/user/memories', () => Response.json([ROW]));
    expect(json.memories[0].content).toBe('Lives in Comilla');
    expect(calls[0].url).toContain(`owner_id=eq.${USER}`);
    expect(calls[0].url).toContain('status=in.(candidate,confirmed)');
  });
});

describe('POST /api/user/memories (import)', () => {
  it('saves new items as confirmed, owned by me, skipping duplicates and blanks', async () => {
    const { res, json, calls } = await call(
      'POST',
      '/api/user/memories',
      (c) =>
        c.method === 'GET'
          ? Response.json([{ content: 'Lives in Comilla' }])
          : Response.json(
              (c.body as any[]).map((r, i) => ({ ...ROW, id: `id-${i}`, content: r.content })),
              { status: 201 }
            ),
      {
        body: {
          source: 'claude',
          items: [
            { content: 'lives in comilla.' },
            { content: 'Works with React' },
            { content: 'Works with React' },
            { content: '   ' },
          ],
        },
      }
    );
    expect(res.status).toBe(201);
    expect(json.added).toBe(1);
    expect(json.skipped).toBe(3);
    const insert = calls.find((c) => c.method === 'POST')!;
    expect(insert.body).toEqual([
      expect.objectContaining({
        owner_id: USER,
        content: 'Works with React',
        source_type: 'claude',
        status: 'confirmed',
        created_by: 'user',
      }),
    ]);
  });

  it('rejects unknown sources, empty and oversized imports', async () => {
    const ok = () => Response.json([]);
    expect(
      (
        await call('POST', '/api/user/memories', ok, {
          body: { source: 'evil', items: [{ content: 'x' }] },
        })
      ).res.status
    ).toBe(400);
    expect(
      (await call('POST', '/api/user/memories', ok, { body: { source: 'chatgpt', items: [] } })).res
        .status
    ).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({ content: `m${i}` }));
    expect(
      (await call('POST', '/api/user/memories', ok, { body: { source: 'chatgpt', items: many } }))
        .res.status
    ).toBe(400);
  });

  it('does not write when everything is a duplicate', async () => {
    const { json, calls } = await call(
      'POST',
      '/api/user/memories',
      () => Response.json([{ content: 'Lives in Comilla' }]),
      { body: { source: 'gemini', items: [{ content: 'Lives in Comilla' }] } }
    );
    expect(json).toMatchObject({ added: 0, skipped: 1 });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });
});

describe('PATCH / DELETE', () => {
  it('edits content only inside my own rows', async () => {
    const { json, calls } = await call(
      'PATCH',
      `/api/user/memories/${MEM}`,
      () => Response.json([{ ...ROW, content: 'Lives in Dhaka' }]),
      { body: { content: 'Lives in Dhaka' } }
    );
    expect(json.memory.content).toBe('Lives in Dhaka');
    expect(calls[0].url).toContain(`id=eq.${MEM}&owner_id=eq.${USER}`);
    expect(calls[0].body).toEqual({ content: 'Lives in Dhaka' });
  });

  it('approves a candidate but never lets the client set other statuses', async () => {
    const ok = () => Response.json([ROW]);
    expect(
      (await call('PATCH', `/api/user/memories/${MEM}`, ok, { body: { status: 'confirmed' } })).res
        .status
    ).toBe(200);
    expect(
      (await call('PATCH', `/api/user/memories/${MEM}`, ok, { body: { status: 'rejected' } })).res
        .status
    ).toBe(400);
    expect((await call('PATCH', `/api/user/memories/${MEM}`, ok, { body: {} })).res.status).toBe(
      400
    );
  });

  it("404s for someone else's memory or a bad id", async () => {
    expect(
      (await call('DELETE', `/api/user/memories/${MEM}`, () => Response.json([]))).res.status
    ).toBe(404);
    const bad = await call('DELETE', '/api/user/memories/nope', () => Response.json([]));
    expect(bad.res.status).toBe(404);
    expect(bad.calls).toHaveLength(0);
  });

  it('deletes one memory, or everything from one source', async () => {
    const one = await call('DELETE', `/api/user/memories/${MEM}`, () =>
      Response.json([{ id: MEM }])
    );
    expect(one.json).toEqual({ success: true });

    const all = await call('DELETE', '/api/user/memories?source=chatgpt', () =>
      Response.json([{ id: 'a' }, { id: 'b' }])
    );
    expect(all.json).toEqual({ success: true, removed: 2 });
    expect(all.calls[0].url).toContain(`owner_id=eq.${USER}`);
    expect(all.calls[0].url).toContain('source_type=eq.chatgpt');

    const unsafe = await call('DELETE', '/api/user/memories?source=a%26owner_id%3Dneq.x', () =>
      Response.json([])
    );
    expect(unsafe.res.status).toBe(400);
  });
});
