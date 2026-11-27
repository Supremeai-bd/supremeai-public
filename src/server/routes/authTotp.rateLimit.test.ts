// @vitest-environment node
import express from 'express';
import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { registerAuthTotpRoutes } from './authTotp';

describe('authTotp per-route rate limit', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
  });

  async function start(): Promise<string> {
    const app = express();
    app.use(express.json());
    registerAuthTotpRoutes(app, {
      activeAuthSessions: new Map(),
      activeAdminSessions: new Map(),
      customerDirectory: [],
      usersDb: [],
      verifyLocalSessionToken: () => null,
      resolveRbacUserProfile: () => ({ isAdminEligible: false }),
      recordAudit: () => {},
    });
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }

  it('returns 429 after 10 verify-2fa attempts per minute from one IP', async () => {
    const base = await start();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${base}/api/auth/verify-2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: '000000', method: 'totp', userEmail: 'x@example.com' }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('limits each TOTP route independently', async () => {
    const base = await start();
    for (let i = 0; i < 10; i++) {
      await fetch(`${base}/api/auth/totp/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: 'x@example.com' }),
      });
    }
    const blocked = await fetch(`${base}/api/auth/totp/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail: 'x@example.com' }),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('ratelimit-policy')).toBeTruthy();
    const status = await fetch(`${base}/api/auth/totp/status?userEmail=x@example.com`);
    expect(status.status).not.toBe(429);
  });
});
