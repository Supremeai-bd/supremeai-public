// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { onRequest } from './admin/[[path]]';
import { resetProviderVaultCache } from '../_lib/providerVault';

describe('functions/api/admin/[[path]] Edge validation & auth gates', () => {
  it('returns 401 when no admin credentials are provided', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/schema-parity', {
        method: 'GET',
      }),
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Administrator authentication is required.' });
  });

  it('returns 403 when invalid admin credentials are provided', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/schema-parity', {
        method: 'GET',
        headers: { 'X-Admin-Token': 'wrong-token' },
      }),
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({ error: 'Administrator elevation is required.' });
  });

  it('returns 503 fail-closed on /api/admin/auth/verify when ADMIN_PASSKEY is not configured', async () => {
    const response = await onRequest({
      env: {},
      request: new Request('https://example.test/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: 'some-passkey' }),
      }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      authenticated: false,
      error: 'Admin access is not configured. Set ADMIN_PASSKEY in the environment.',
    });
  });

  it('returns 400 when passkey is empty on /api/admin/auth/verify', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: '' }),
      }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      error: expect.stringContaining('Passkey is required'),
    });
  });

  it('returns 401 when passkey is incorrect on /api/admin/auth/verify', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: 'wrong-passkey' }),
      }),
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      error: 'Invalid administrator passkey. Access denied.',
    });
  });

  it('returns 200 when passkey is correct on /api/admin/auth/verify', async () => {
    const response = await onRequest({
      env: { ADMIN_PASSKEY: 'secret123' },
      request: new Request('https://example.test/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkey: 'secret123' }),
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      authenticated: true,
      role: 'admin',
    });
  });
});

describe('functions/api/admin real data (vault + users)', () => {
  const GROQ_VALUE = 'gsk_live_route_test_1234567890';

  it('lists vault/env provider keys instead of the empty backend stub', async () => {
    resetProviderVaultCache();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://api.groq.com/openai/v1/models') {
        return new Response('{"data":[]}', { status: 200 });
      }
      // ব্যাকএন্ড স্টাব: ফাঁকা তালিকা
      return new Response('{"providers":[]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      const response = await onRequest({
        env: { ADMIN_PASSKEY: 'secret123', GROQ_API_KEY: GROQ_VALUE },
        request: new Request('https://example.test/api/admin/providers', {
          headers: { 'X-Admin-Token': 'secret123' },
        }),
      });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(GROQ_VALUE);
      const body = JSON.parse(text);
      expect(body.source).toBe('edge-vault');
      expect(body.providers).toHaveLength(1);
      expect(body.providers[0]).toMatchObject({ provider: 'groq', status: 'healthy' });
      expect(body.vaultSummary).toMatchObject({ connected: false, mode: 'edge-env-only' });
    } finally {
      spy.mockRestore();
      resetProviderVaultCache();
    }
  });

  it('merges Supabase auth users into /api/admin/customers', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('https://db.test/auth/v1/admin/users')) {
        return new Response(
          JSON.stringify({
            users: [{ id: 'u1', email: 'real@user.io', created_at: '2026-11-20' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{"customers":[]}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      const response = await onRequest({
        env: {
          ADMIN_PASSKEY: 'secret123',
          SUPABASE_URL: 'https://db.test',
          SUPABASE_SERVICE_ROLE_KEY: 'svc',
        },
        request: new Request('https://example.test/api/admin/customers', {
          headers: { 'X-Admin-Token': 'secret123' },
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.provenance).toBe('supabase-auth');
      expect(body.customers.map((c: { email: string }) => c.email)).toEqual(['real@user.io']);
    } finally {
      spy.mockRestore();
    }
  });
});
