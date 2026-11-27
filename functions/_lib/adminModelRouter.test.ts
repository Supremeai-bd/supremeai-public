import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAdminModelRouterRoute } from './adminModelRouter';
import { resetCoreTokenCache, resolveCoreServiceToken } from './coreAdminBridge';

const ENV = { SUPREMEAI_API_TOKEN: 'core-token', SUPREMEAI_CORE_URL: 'https://core.test/' };

type Call = { url: string; method: string; auth: string | null; body: unknown };

function fakeCore(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method,
      auth: headers.get('Authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const handler = routes[`${method} ${new URL(url).pathname}`];
    return handler ? handler() : new Response('{"detail":"Not Found"}', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function call(
  path: string,
  method: string,
  routes: Record<string, () => Response>,
  body?: unknown,
  env: Record<string, string> = ENV
) {
  const { fetchImpl, calls } = fakeCore(routes);
  const audit: { details?: string } = {};
  const res = await handleAdminModelRouterRoute(
    path,
    new Request(`https://studio.test${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    audit,
    fetchImpl
  );
  return { res: res!, json: (await res!.json()) as Record<string, any>, calls, audit };
}

const ROUTER = () =>
  Response.json({
    current_override: {
      provider: 'groq',
      model: 'groq/llama',
      set_by: 'ops@x.com',
      set_at: '2026-11-27T10:00:00Z',
    },
    override_remaining_requests: 7,
    fallback_chain: ['groq/llama', 'gemini/flash'],
  });
const PROVIDERS = () =>
  Response.json([
    { id: 'groq', status: 'healthy', latency_ms: 120.5, models: ['groq/llama'] },
    { id: 'gemini', status: 'unavailable', latency_ms: 0, models: ['gemini/flash'] },
  ]);

beforeEach(() => resetCoreTokenCache());

describe('GET /api/admin/model-router', () => {
  it('reads live core state with the core service token', async () => {
    const { res, json, calls } = await call('/api/admin/model-router', 'GET', {
      'GET /api/admin/llm/router': ROUTER,
      'GET /api/admin/llm/providers': PROVIDERS,
    });
    expect(res.status).toBe(200);
    expect(json.override).toEqual({
      provider: 'groq',
      model: 'groq/llama',
      remainingRequests: 7,
      setBy: 'ops@x.com',
      setAt: '2026-11-27T10:00:00Z',
    });
    expect(json.providers).toHaveLength(2);
    expect(json.fallbackChain[0]).toBe('groq/llama');
    expect(calls[0].url).toBe('https://core.test/api/admin/llm/router');
    expect(calls.every((c) => c.auth === 'Bearer core-token')).toBe(true);
    expect(JSON.stringify(json)).not.toContain('core-token');
  });

  it('keeps router state when only the provider list fails', async () => {
    const { json } = await call('/api/admin/model-router', 'GET', {
      'GET /api/admin/llm/router': ROUTER,
      'GET /api/admin/llm/providers': () => new Response('{}', { status: 500 }),
    });
    expect(json.success).toBe(true);
    expect(json.providers).toEqual([]);
    expect(json.providersError).toBeTruthy();
  });

  it('says "not linked" when no core token exists anywhere', async () => {
    const { res, json, calls } = await call('/api/admin/model-router', 'GET', {}, undefined, {});
    expect(res.status).toBe(503);
    expect(json).toMatchObject({ linked: false });
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/admin/model-router/override', () => {
  it('validates input before calling core', async () => {
    const routes = { 'POST /api/admin/llm/router/override': () => Response.json({}) };
    const bad = [
      { provider: '' },
      { provider: 'groq', model: 'gemini/flash' },
      { provider: 'groq', remainingRequests: -1 },
      { provider: 'groq', remainingRequests: 1.5 },
      { provider: '../etc' },
    ];
    for (const body of bad) {
      const { res, calls } = await call('/api/admin/model-router/override', 'POST', routes, body);
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    }
  });

  it('forwards a valid override and records an audit detail', async () => {
    const { res, calls, audit } = await call(
      '/api/admin/model-router/override',
      'POST',
      { 'POST /api/admin/llm/router/override': () => Response.json({ status: 'success' }) },
      { provider: 'groq', model: 'groq/llama', remainingRequests: 50 }
    );
    expect(res.status).toBe(200);
    expect(calls[0].body).toEqual({
      provider: 'groq',
      model: 'groq/llama',
      remaining_requests: 50,
    });
    expect(audit.details).toBe('model override → groq/llama for 50 requests');
  });

  it('passes core validation errors through', async () => {
    const { res, json } = await call(
      '/api/admin/model-router/override',
      'POST',
      {
        'POST /api/admin/llm/router/override': () =>
          Response.json({ detail: 'Unknown provider: zzz' }, { status: 400 }),
      },
      { provider: 'zzz' }
    );
    expect(res.status).toBe(400);
    expect(json.error).toBe('Unknown provider: zzz');
  });
});

describe('DELETE /api/admin/model-router/override', () => {
  it('clears the override', async () => {
    const { res, json, audit } = await call('/api/admin/model-router/override', 'DELETE', {
      'DELETE /api/admin/llm/router/override': () => Response.json({ cleared: true }),
    });
    expect(res.status).toBe(200);
    expect(json.cleared).toBe(true);
    expect(audit.details).toBe('model override cleared');
  });

  it('is honest (501) when core does not have the route yet', async () => {
    const { res, json } = await call('/api/admin/model-router/override', 'DELETE', {
      'POST /api/admin/llm/router/override': () => Response.json({}),
    });
    expect(res.status).toBe(501);
    expect(json.notWired).toBe(true);
  });
});

describe('resolveCoreServiceToken', () => {
  it('falls back to Infisical and caches the answer', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/universal-auth/login')) return Response.json({ accessToken: 'inf' });
      return Response.json({
        secrets: [{ secretKey: 'SUPREMEAI_API_TOKEN', secretValue: 'from-vault' }],
      });
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const env = {
      INFISICAL_PROJECT_ID: 'p',
      INFISICAL_CLIENT_ID: 'c',
      INFISICAL_CLIENT_SECRET: 's',
    };
    expect(await resolveCoreServiceToken(env, fetchImpl)).toEqual({
      token: 'from-vault',
      source: 'infisical',
    });
    await resolveCoreServiceToken(env, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // login + secrets once, then cached
  });
});
