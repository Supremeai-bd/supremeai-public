// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerAuthRoutes, type AuthContext } from './auth';

// Covers the upstream-gateway branches of routes/auth.ts, where untyped JSON is narrowed
// field-by-field (no `any`): nested `user`, snake_case aliases, non-string junk ignored.

const realFetch = globalThis.fetch;
let server: http.Server;
let base = '';
let upstreamBody: unknown = null;
let upstreamStatus = 200;
const rbacCalls: unknown[][] = [];

function buildCtx(): AuthContext {
  return {
    customerDirectory: [],
    usersDb: [],
    activeAuthSessions: new Map(),
    activeAdminSessions: new Map(),
    activeRefreshTokens: new Map(),
    upstreamTokenAdminCache: new Map(),
    isIpBlocked: () => false,
    platformConfig: { allowNewSignups: true },
    buildSafeAuthUser: () => {
      throw new Error('local users are not part of this test');
    },
    signLocalSessionToken: () => 'local-token',
    verifyLocalSessionToken: () => null,
    issueLocalRefreshToken: () => 'rt_local',
    setRefreshTokenCookie: () => undefined,
    setAdminSessionCookie: () => undefined,
    resolveRbacUserProfile: (...args) => {
      rbacCalls.push(args);
      const hints = args[1] as { rbacRole?: string; isAdminEligible?: boolean } | undefined;
      const isAdmin = Boolean(hints?.isAdminEligible || hints?.rbacRole === 'admin');
      return {
        isAdminEligible: isAdmin,
        adminEmailMatched: false,
        rbacRole: isAdmin ? 'admin' : 'user',
        role: isAdmin ? 'admin' : 'user',
        isDeveloperEligible: isAdmin,
        adminUserId: undefined,
        adminEmails: args[3] ?? [],
      };
    },
    recordAudit: () => undefined,
  };
}

beforeAll(async () => {
  process.env.SUPREMEAI_BACKEND_URL = 'https://gateway.test';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://gateway.test/')) {
      return new Response(JSON.stringify(upstreamBody), {
        status: upstreamStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return realFetch(input, init);
  });
  const app = express();
  app.use(express.json());
  registerAuthRoutes(app, buildCtx());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  rbacCalls.length = 0;
  upstreamStatus = 200;
});

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.SUPREMEAI_BACKEND_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function postLogin() {
  const res = await realFetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'Remote@Example.com', password: 'pw' }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('routes/auth upstream narrowing', () => {
  it('reads the nested user object, snake_case aliases and string-only admin emails', async () => {
    upstreamBody = {
      access_token: 'sk-upstream',
      admin_emails: ['ops@example.com', 42, null],
      user: { user_id: 'usr-abc', name: 'Remote', rbac_role: 'admin', plan: 'Enterprise' },
    };
    const { status, body } = await postLogin();
    expect(status).toBe(200);
    const user = body.user as Record<string, unknown>;
    expect(user).toMatchObject({
      id: 'usr-abc',
      name: 'Remote',
      email: 'remote@example.com',
      role: 'admin',
      plan: 'Enterprise',
      adminEmails: ['ops@example.com'],
    });
    expect(rbacCalls[0][1]).toMatchObject({ rbacRole: 'admin' });
    expect(rbacCalls[0][4]).toBe('admin');
  });

  it('ignores non-string role/plan values instead of trusting them', async () => {
    upstreamBody = { token: 'sk-upstream', role: { admin: true }, plan: 7, id: 'usr-x' };
    const { status, body } = await postLogin();
    expect(status).toBe(200);
    const user = body.user as Record<string, unknown>;
    expect(user.role).toBe('user');
    expect(user.plan).toBe('Pro');
    expect(rbacCalls[0][4]).toBeUndefined();
  });

  it('merges /me payloads with a nested user for upstream tokens', async () => {
    upstreamBody = {
      adminEmails: ['a@example.com'],
      user: { email: 'Me@Example.com', id: 'usr-me', is_admin: true },
    };
    const res = await realFetch(`${base}/api/auth/me`, {
      headers: { Authorization: 'Bearer sk-upstream-session' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      id: 'usr-me',
      email: 'me@example.com',
      role: 'admin',
      adminEmails: ['a@example.com'],
    });
  });

  it('returns 401 when the upstream rejects the session', async () => {
    upstreamStatus = 401;
    upstreamBody = { detail: 'expired' };
    const res = await realFetch(`${base}/api/auth/me`, {
      headers: { Authorization: 'Bearer sk-upstream-session' },
    });
    expect(res.status).toBe(401);
  });
});
