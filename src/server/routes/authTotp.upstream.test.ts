// @vitest-environment node
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerAuthTotpRoutes, type AuthTotpContext } from './authTotp';

// Upstream-session branch of resolveAdminEligibilityForTotp: untyped /auth/me JSON is
// narrowed (nested user, snake_case aliases, string-only role and admin-email values).

const realFetch = globalThis.fetch;
let server: http.Server;
let base = '';
let upstreamBody: unknown = null;
const rbacCalls: Parameters<AuthTotpContext['resolveRbacUserProfile']>[] = [];

beforeAll(async () => {
  process.env.SUPREMEAI_BACKEND_URL = 'https://gateway.test';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://gateway.test/')) {
      return new Response(JSON.stringify(upstreamBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input, init);
  });
  const app = express();
  app.use(express.json());
  registerAuthTotpRoutes(app, {
    activeAuthSessions: new Map(),
    activeAdminSessions: new Map(),
    customerDirectory: [],
    usersDb: [],
    verifyLocalSessionToken: () => null,
    resolveRbacUserProfile: (...args) => {
      rbacCalls.push(args);
      return { isAdminEligible: args[1]?.rbacRole === 'admin' };
    },
    recordAudit: () => {},
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  rbacCalls.length = 0;
});

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.SUPREMEAI_BACKEND_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function getStatus(query = '') {
  return realFetch(`${base}/api/auth/totp/status${query}`, {
    headers: { Authorization: 'Bearer sk-upstream-session' },
  });
}

describe('authTotp upstream eligibility narrowing', () => {
  it('accepts an upstream admin via nested user + snake_case role', async () => {
    upstreamBody = {
      adminEmails: ['ops@example.com', 5],
      user: { email: 'Admin@Example.com', rbac_role: 'admin', admin_user_id: 'adm-1' },
    };
    const res = await getStatus();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accountName: 'admin@example.com' });
    const [email, hints, , adminEmails, rawRole] = rbacCalls[0];
    expect(email).toBe('admin@example.com');
    expect(hints).toMatchObject({ rbacRole: 'admin', adminUserId: 'adm-1' });
    expect(adminEmails).toEqual(['ops@example.com']);
    expect(rawRole).toBe('admin');
  });

  it('ignores a non-string role object instead of trusting it', async () => {
    upstreamBody = { email: 'x@example.com', role: { admin: true } };
    const res = await getStatus();
    expect(res.status).toBe(403);
    expect(rbacCalls[0][1]?.rbacRole).toBeUndefined();
  });

  it('rejects when the requested email differs from the upstream session', async () => {
    upstreamBody = { email: 'admin@example.com', role: 'admin' };
    const res = await getStatus('?userEmail=other@example.com');
    expect(res.status).toBe(403);
    expect(rbacCalls).toHaveLength(0);
  });
});
