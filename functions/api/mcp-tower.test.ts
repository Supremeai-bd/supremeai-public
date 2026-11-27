// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicTowerRequest, onRequest } from './mcp-tower/[[path]]';

const okJson = () =>
  new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('functions/api/mcp-tower auth gate', () => {
  it('classifies only read-only GETs as public', () => {
    expect(isPublicTowerRequest('GET', 'health')).toBe(true);
    expect(isPublicTowerRequest('GET', 'services')).toBe(true);
    expect(isPublicTowerRequest('GET', 'deployments')).toBe(true);
    expect(isPublicTowerRequest('POST', 'reboot')).toBe(false);
    expect(isPublicTowerRequest('POST', 'reboot-all')).toBe(false);
    expect(isPublicTowerRequest('POST', 'probe')).toBe(false);
    expect(isPublicTowerRequest('GET', 'admin/secrets')).toBe(false);
    expect(isPublicTowerRequest('DELETE', 'services')).toBe(false);
  });

  it('rejects reboot without credentials (401) and with a wrong key (403)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okJson());
    const anon = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://studio.test/api/mcp-tower/reboot', {
        method: 'POST',
        body: '{"serviceId":"api"}',
      }),
    });
    expect(anon.status).toBe(401);

    const wrong = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://studio.test/api/mcp-tower/reboot-all', {
        method: 'POST',
        headers: { 'X-Admin-Token': 'nope' },
      }),
    });
    expect(wrong.status).toBe(403);
    // কোনো আপস্ট্রিম/টাওয়ার কল হওয়ার আগেই আটকে যায় (শুধু সেশন-যাচাই কল হতে পারে)
    const towerCalls = fetchSpy.mock.calls.filter(([u]) => !String(u).includes('/auth'));
    expect(towerCalls.every(([u]) => !/\/health$/.test(String(u)))).toBe(true);
  });

  it('does not forward unknown tower paths for anonymous callers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okJson());
    const res = await onRequest({
      env: {},
      request: new Request('https://studio.test/api/mcp-tower/admin/run', { method: 'POST' }),
    });
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets an admin probe and reports unmeasured CPU/memory as null (no fake numbers)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okJson());
    const res = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://studio.test/api/mcp-tower/probe', {
        method: 'POST',
        headers: { 'X-Admin-Token': 'secret123' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      services: Array<{ cpuPercent: unknown; memoryMb: unknown; uptime: string }>;
    };
    expect(body.services.length).toBeGreaterThan(0);
    for (const svc of body.services) {
      expect(svc.cpuPercent).toBeNull();
      expect(svc.memoryMb).toBeNull();
      expect(svc.uptime).not.toBe('99.9%');
    }
  });

  it('keeps public health readable without credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => okJson());
    const res = await onRequest({
      env: {},
      request: new Request('https://studio.test/api/mcp-tower/health'),
    });
    expect(res.status).toBe(200);
  });
});
