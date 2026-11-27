import { describe, expect, it, vi } from 'vitest';
import {
  buildPackageRow,
  handleAdminPackagesRoute,
  handlePublicPackagesRoute,
  mapPackage,
} from './creditPackages';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const ID = '0b6f8f2e-6c55-4c8b-9a0e-3f3c2a1d9e11';
const ROW = {
  id: ID,
  kind: 'topup',
  name: 'Growth pack',
  description: 'Never expires',
  credits: 1500000,
  price_usd: '50.00',
  billing_period: 'one_time',
  badge: 'popular',
  sort_order: 40,
  active: true,
  updated_at: '2026-11-27T18:00:00Z',
};

type Call = {
  url: string;
  method: string;
  body: unknown;
  prefer: string | null;
  auth: string | null;
};

function fakeDb(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(input),
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      prefer: headers.get('Prefer'),
      auth: headers.get('Authorization'),
    };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

async function admin(
  method: string,
  path: string,
  respond: (call: Call) => Response,
  body?: unknown,
  env: Record<string, string> = ENV
) {
  const { fetchImpl, calls } = fakeDb(respond);
  const audit: { actor: string; details?: string } = { actor: 'owner@x.com' };
  const res = await handleAdminPackagesRoute(
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
  return { res, json: res ? ((await res.json()) as Record<string, any>) : null, calls, audit };
}

describe('mapPackage', () => {
  it('converts DB rows (numeric strings included) to the client shape', () => {
    expect(mapPackage(ROW)).toEqual({
      id: ID,
      kind: 'topup',
      name: 'Growth pack',
      description: 'Never expires',
      credits: 1500000,
      priceUsd: 50,
      billingPeriod: 'one_time',
      badge: 'popular',
      sortOrder: 40,
      active: true,
      updatedAt: '2026-11-27T18:00:00Z',
    });
  });
});

describe('buildPackageRow', () => {
  it('requires name, credits and price on create', () => {
    expect(buildPackageRow({ name: 'X', credits: 10 }, false)).toMatchObject({ ok: false });
    expect(buildPackageRow({ name: '', credits: 10, priceUsd: 1 }, false)).toMatchObject({
      ok: false,
    });
    expect(buildPackageRow({ name: 'X', credits: 0, priceUsd: 1 }, false)).toMatchObject({
      ok: false,
    });
    expect(buildPackageRow({ name: 'X', credits: 1.5, priceUsd: 1 }, false)).toMatchObject({
      ok: false,
    });
    expect(buildPackageRow({ name: 'X', credits: 10, priceUsd: -1 }, false)).toMatchObject({
      ok: false,
    });
  });

  it('defaults the billing period from the type and rounds the price to cents', () => {
    const plan = buildPackageRow({ kind: 'plan', name: 'Pro', credits: 5, priceUsd: 9.999 }, false);
    expect(plan).toMatchObject({
      ok: true,
      row: { kind: 'plan', billing_period: 'monthly', price_usd: 10 },
    });
    const pack = buildPackageRow({ name: 'Pack', credits: 5, priceUsd: 3 }, false);
    expect(pack).toMatchObject({ ok: true, row: { kind: 'topup', billing_period: 'one_time' } });
  });

  it('patch only touches the fields sent and rejects an empty patch', () => {
    expect(buildPackageRow({ active: false }, true)).toEqual({
      ok: true,
      row: { active: false },
      summary: 'hidden',
    });
    expect(buildPackageRow({}, true)).toMatchObject({ ok: false, error: 'Nothing to update.' });
    expect(buildPackageRow({ kind: 'bogus' }, true)).toMatchObject({ ok: false });
    expect(buildPackageRow({ active: 'yes' }, true)).toMatchObject({ ok: false });
  });
});

describe('GET /api/packages (public)', () => {
  it('returns only active packages, read with the service role', async () => {
    const { fetchImpl, calls } = fakeDb(() => Response.json([ROW]));
    const res = await handlePublicPackagesRoute(
      '/api/packages',
      new Request('https://studio.test/api/packages'),
      ENV,
      fetchImpl
    );
    const json = (await res!.json()) as Record<string, any>;
    expect(res!.status).toBe(200);
    expect(json.packages[0]).toMatchObject({ name: 'Growth pack', priceUsd: 50 });
    expect(calls[0].url).toContain('active=is.true');
    expect(calls[0].auth).toBe('Bearer service-key');
  });

  it('is 503 when the store is not linked and ignores other paths', async () => {
    const { fetchImpl } = fakeDb(() => Response.json([]));
    const req = new Request('https://studio.test/api/packages');
    expect((await handlePublicPackagesRoute('/api/packages', req, {}, fetchImpl))!.status).toBe(
      503
    );
    expect(await handlePublicPackagesRoute('/api/other', req, ENV, fetchImpl)).toBeNull();
  });

  it('rejects writes', async () => {
    const { fetchImpl } = fakeDb(() => Response.json([]));
    const res = await handlePublicPackagesRoute(
      '/api/packages',
      new Request('https://studio.test/api/packages', { method: 'POST' }),
      ENV,
      fetchImpl
    );
    expect(res!.status).toBe(405);
  });
});

describe('/api/admin/packages (admin CRUD)', () => {
  it('lists every package, hidden ones included', async () => {
    const { json, calls } = await admin('GET', '/api/admin/packages', () =>
      Response.json([ROW, { ...ROW, id: 'x', active: false }])
    );
    expect(json!.packages).toHaveLength(2);
    expect(calls[0].url).not.toContain('active=is.true');
  });

  it('adds a package and records who did it in the audit trail', async () => {
    const { res, json, calls, audit } = await admin(
      'POST',
      '/api/admin/packages',
      () => Response.json([ROW], { status: 201 }),
      { kind: 'topup', name: 'Growth pack', credits: 1500000, priceUsd: 50 }
    );
    expect(res!.status).toBe(201);
    expect(json!.package.name).toBe('Growth pack');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].prefer).toBe('return=representation');
    expect(calls[0].body).toMatchObject({ name: 'Growth pack', updated_by: 'owner@x.com' });
    expect(audit.details).toMatch(/package added/);
  });

  it('rejects an invalid package without touching the DB', async () => {
    const { res, calls } = await admin('POST', '/api/admin/packages', () => Response.json([]), {
      name: 'X',
      credits: -5,
      priceUsd: 1,
    });
    expect(res!.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('edits a package by id', async () => {
    const { json, calls, audit } = await admin(
      'PATCH',
      `/api/admin/packages/${ID}`,
      () => Response.json([{ ...ROW, price_usd: 45 }]),
      { priceUsd: 45 }
    );
    expect(json!.package.priceUsd).toBe(45);
    expect(calls[0].url).toContain(`id=eq.${ID}`);
    expect(calls[0].body).toEqual({ price_usd: 45, updated_by: 'owner@x.com' });
    expect(audit.details).toMatch(/Growth pack.*price=\$45/);
  });

  it('removes a package and 404s on unknown ids', async () => {
    const del = await admin('DELETE', `/api/admin/packages/${ID}`, () =>
      Response.json([{ id: ID, name: 'Growth pack' }])
    );
    expect(del.json).toEqual({ success: true });
    expect(del.audit.details).toBe('package removed: "Growth pack"');

    const missing = await admin('DELETE', `/api/admin/packages/${ID}`, () => Response.json([]));
    expect(missing.res!.status).toBe(404);

    const bad = await admin('DELETE', '/api/admin/packages/not-a-uuid', () => Response.json([]));
    expect(bad.res!.status).toBe(404);
    expect(bad.calls).toHaveLength(0);
  });

  it('reports a DB outage instead of pretending success', async () => {
    const { res } = await admin(
      'GET',
      '/api/admin/packages',
      () => new Response('x', { status: 500 })
    );
    expect(res!.status).toBe(502);
    const unlinked = await admin(
      'GET',
      '/api/admin/packages',
      () => Response.json([]),
      undefined,
      {}
    );
    expect(unlinked.res!.status).toBe(503);
  });

  it('ignores unrelated admin paths', async () => {
    const { res } = await admin('GET', '/api/admin/alerts', () => Response.json([]));
    expect(res).toBeNull();
  });
});
