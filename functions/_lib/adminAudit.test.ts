// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  auditStatusFor,
  buildAuditRow,
  handleAdminAuditLogRoute,
  isAuditableMethod,
  recordAdminAudit,
  withAdminAudit,
} from './adminAudit';
import { onRequest as adminOnRequest } from '../api/admin/[[path]]';

const SUPA_ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc' };

function okFetch() {
  return vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;
}

describe('adminAudit helpers', () => {
  it('only audits write methods', () => {
    expect(isAuditableMethod('POST')).toBe(true);
    expect(isAuditableMethod('delete')).toBe(true);
    expect(isAuditableMethod('GET')).toBe(false);
    expect(isAuditableMethod('OPTIONS')).toBe(false);
  });

  it('classifies outcomes', () => {
    expect(auditStatusFor(200)).toBe('success');
    expect(auditStatusFor(403)).toBe('denied');
    expect(auditStatusFor(401)).toBe('denied');
    expect(auditStatusFor(501)).toBe('failure');
  });

  it('maps onto audit_logs columns without any request body', () => {
    const row = buildAuditRow({
      method: 'post',
      path: '/api/admin/queue/flush',
      actor: 'owner@x.com',
      httpStatus: 501,
      latencyMs: 12.4,
      errorMessage: 'x'.repeat(500),
      dryRun: true,
    });
    expect(row).toMatchObject({
      action: 'POST /api/admin/queue/flush',
      action_type: 'admin_action',
      actor: 'owner@x.com',
      resource: '/api/admin/queue/flush',
      status: 'failure',
      latency_ms: 12,
      metadata: { method: 'POST', httpStatus: 501, dryRun: true },
    });
    expect(String(row.error_message).length).toBe(300);
    expect(JSON.stringify(row)).not.toContain('body');
  });

  it('writes to Supabase REST with the service key and never throws', async () => {
    const fetchImpl = okFetch();
    const ok = await recordAdminAudit(
      SUPA_ENV,
      { method: 'POST', path: '/p', actor: 'a', httpStatus: 200, latencyMs: 1 },
      fetchImpl
    );
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://db.test/rest/v1/audit_logs');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer svc');

    const boom = vi.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordAdminAudit(
        SUPA_ENV,
        { method: 'POST', path: '/p', actor: 'a', httpStatus: 200, latencyMs: 1 },
        boom
      )
    ).resolves.toBe(false);
    await expect(
      recordAdminAudit(
        {},
        { method: 'POST', path: '/p', actor: 'a', httpStatus: 200, latencyMs: 1 }
      )
    ).resolves.toBe(false);
    err.mockRestore();
  });
});

describe('withAdminAudit', () => {
  it('records writes (with actor and error) via waitUntil, skips reads', async () => {
    const fetchImpl = okFetch();
    const waitUntil = vi.fn();
    const request = new Request('https://x.test/api/admin/queue/flush', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.9' },
    });
    const res = await withAdminAudit(
      { request, env: SUPA_ENV, waitUntil },
      async (audit) => {
        audit.actor = 'owner@x.com';
        return Response.json({ error: 'not wired' }, { status: 501 });
      },
      fetchImpl
    );
    expect(res.status).toBe(501);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toMatchObject({
      actor: 'owner@x.com',
      status: 'failure',
      error_message: 'not wired',
      ip_address: '203.0.113.9',
    });

    const readFetch = okFetch();
    await withAdminAudit(
      { request: new Request('https://x.test/api/admin/customers'), env: SUPA_ENV },
      async () => Response.json({}),
      readFetch
    );
    expect(readFetch).not.toHaveBeenCalled();
  });

  it('respects audit.skip for public requests', async () => {
    const fetchImpl = okFetch();
    await withAdminAudit(
      {
        request: new Request('https://x.test/api/mcp-tower/rpc', { method: 'POST' }),
        env: SUPA_ENV,
      },
      async (audit) => {
        audit.skip = true;
        return Response.json({});
      },
      fetchImpl
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/audit', () => {
  it('maps audit_logs rows onto Audit Trail records and clamps the limit', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json([
        {
          id: 7,
          created_at: '2026-11-27T12:00:00Z',
          actor: 'owner@x.com',
          action: 'POST /api/admin/queue/flush-dlq',
          resource: '/api/admin/queue/flush-dlq',
          status: 'failure',
          error_message: 'not wired',
          latency_ms: 40,
          ip_address: '203.0.113.9',
          metadata: { httpStatus: 501 },
        },
      ])
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const res = await handleAdminAuditLogRoute(
      '/api/admin/audit',
      new Request('https://x.test/api/admin/audit?limit=9999'),
      SUPA_ENV,
      fetchImpl
    );
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({
      linked: true,
      auditRecords: [
        {
          id: 'audit_7',
          timestamp: '2026-11-27T12:00:00Z',
          actor: 'owner@x.com',
          action: 'POST /api/admin/queue/flush-dlq',
          resource: '/api/admin/queue/flush-dlq',
          details: 'failure · HTTP 501 · 40 ms — not wired',
          ipAddress: '203.0.113.9',
        },
      ],
    });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get('limit')).toBe('200');
    expect(url.searchParams.get('action_type')).toBe('eq.admin_action');
  });

  it('reports an unlinked store honestly (503, no fake rows)', async () => {
    const res = await handleAdminAuditLogRoute(
      '/api/admin/audit',
      new Request('https://x.test/api/admin/audit'),
      {}
    );
    expect(res!.status).toBe(503);
    expect(await res!.json()).toMatchObject({ linked: false, auditRecords: [] });
  });
});

describe('admin edge write fallbacks are fail-honest', () => {
  it('returns 501 instead of a fake success when the backend lacks the route', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as typeof fetch;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await adminOnRequest({
        env: { ADMIN_PASSKEY: 'k' },
        request: new Request('https://x.test/api/admin/security/block-ip/1.2.3.4', {
          method: 'POST',
          headers: { 'X-Admin-Token': 'k' },
        }),
      });
      expect(res.status).toBe(501);
      expect(await res.json()).toMatchObject({ success: false, notWired: true });
    } finally {
      globalThis.fetch = realFetch;
      err.mockRestore();
    }
  });
});
