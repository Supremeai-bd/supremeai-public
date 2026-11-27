import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFinOpsUpdate, handleAdminFinOpsRoute } from './adminFinOps';
import { resetCoreTokenCache } from './coreAdminBridge';

const ENV = { SUPREMEAI_API_TOKEN: 'core-token', SUPREMEAI_CORE_URL: 'https://core.test/' };

type Call = { url: string; method: string; auth: string | null; body: unknown };

function fakeCore(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    calls.push({
      url,
      method,
      auth: new Headers(init?.headers).get('Authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const handler = routes[`${method} ${new URL(url).pathname}`];
    return handler ? handler() : new Response('{"detail":"Not Found"}', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function call(
  method: string,
  routes: Record<string, () => Response>,
  body?: unknown,
  path = '/api/admin/finops'
) {
  const { fetchImpl, calls } = fakeCore(routes);
  const audit: { details?: string; actor?: string } = { actor: 'owner@x.com' };
  const res = await handleAdminFinOpsRoute(
    path,
    new Request(`https://studio.test${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    ENV,
    audit,
    fetchImpl
  );
  return { res, json: res ? ((await res.json()) as Record<string, any>) : null, calls, audit };
}

const CORE_GET = () =>
  Response.json({
    settings: {
      enforce: true,
      user_daily_tokens: 200000,
      user_rpm: 20,
      global_daily_tokens: 0,
      updated_by: 'ops@x.com',
      updated_at: '2026-11-27T10:00:00Z',
    },
    usage: {
      available: true,
      date: '2026-11-27',
      globalTokens: 1500,
      topUsers: [
        { userId: 'u1', tokens: 1200 },
        { userId: '', tokens: 3 },
      ],
    },
  });

beforeEach(() => resetCoreTokenCache());

describe('GET /api/admin/finops', () => {
  it('returns live limits + usage from core with the service token', async () => {
    const { res, json, calls } = await call('GET', { 'GET /api/admin/llm/finops': CORE_GET });
    expect(res!.status).toBe(200);
    expect(calls[0]).toMatchObject({
      url: 'https://core.test/api/admin/llm/finops',
      auth: 'Bearer core-token',
    });
    expect(json!.settings).toEqual({
      enforce: true,
      userDailyTokens: 200000,
      userRpm: 20,
      globalDailyTokens: 0,
      updatedBy: 'ops@x.com',
      updatedAt: '2026-11-27T10:00:00Z',
    });
    expect(json!.usage).toEqual({
      available: true,
      date: '2026-11-27',
      globalTokens: 1500,
      topUsers: [{ userId: 'u1', tokens: 1200 }],
    });
  });

  it('reports not-wired (501) when core has no FinOps route yet', async () => {
    const { res, json } = await call('GET', {});
    expect(res!.status).toBe(501);
    expect(json!.notWired).toBe(true);
  });

  it('ignores other paths', async () => {
    const { res } = await call('GET', {}, undefined, '/api/admin/other');
    expect(res).toBeNull();
  });
});

describe('PUT /api/admin/finops', () => {
  it('sends snake_case limits + actor to core and writes an audit summary', async () => {
    const { res, json, calls, audit } = await call(
      'PUT',
      { 'PUT /api/admin/llm/finops': CORE_GET },
      { userRpm: 30, enforce: false }
    );
    expect(res!.status).toBe(200);
    expect(json!.success).toBe(true);
    expect(calls[0].body).toEqual({ enforce: false, user_rpm: 30, updated_by: 'owner@x.com' });
    expect(audit.details).toBe('finops limits → enforce=false, userRpm=30');
  });

  it('rejects invalid input without calling core', async () => {
    const { res, calls } = await call('PUT', {}, { userRpm: -5 });
    expect(res!.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('passes core validation errors through as 400', async () => {
    const { res, json } = await call(
      'PUT',
      {
        'PUT /api/admin/llm/finops': () => Response.json({ detail: 'bad limit' }, { status: 400 }),
      },
      { userRpm: 5 }
    );
    expect(res!.status).toBe(400);
    expect(json!.error).toBe('bad limit');
  });
});

describe('buildFinOpsUpdate', () => {
  it('validates types and ranges', () => {
    expect(buildFinOpsUpdate({})).toEqual({ ok: false, error: 'Nothing to update.' });
    expect(buildFinOpsUpdate({ enforce: 'yes' }).ok).toBe(false);
    expect(buildFinOpsUpdate({ userDailyTokens: 1.5 }).ok).toBe(false);
    expect(buildFinOpsUpdate({ globalDailyTokens: 6_000_000_000 }).ok).toBe(false);
    expect(buildFinOpsUpdate({ globalDailyTokens: 0 })).toMatchObject({
      ok: true,
      update: { global_daily_tokens: 0 },
    });
  });
});
