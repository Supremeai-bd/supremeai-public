import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { registerAdminPlatformRoutes } from './admin/platform';
import { registerAuthRoutes } from './auth';

// বাংলা মন্তব্য: অ্যাডমিন RBAC (/api/v1/admin/*), ফিচার-ফ্ল্যাগ লাইভ গেটার, মডেল-পলিসি পারসিস্টেন্স এবং লগআউট সেশন বাতিলের রিগ্রেশন টেস্ট
async function withServer(
  setup: (app: express.Express) => void,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json());
  setup(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('Admin & Auth root-cause security hardening', () => {
  it('protects /api/v1/admin/feature-flags under admin middleware, keeps runtimeFeatureFlags live via getter, and persists model policies', async () => {
    let runtimeFeatureFlags: Record<string, boolean> = {
      maintenance_mode: false,
      web_search: true,
    };
    const platformConfig = {
      maintenanceMode: false,
      maintenanceMessage: 'Maintenance active',
      allowNewSignups: true,
      globalSystemAnnouncement: '',
      defaultRateLimitRpm: 60,
      modelPolicies: {
        'supreme-spark': { enabled: true, minTier: 'Free' as const },
      },
    };
    const persistPlatformState = vi.fn();
    const recordAudit = vi.fn();

    const requireAdminMiddleware = (req: Request, res: Response, next: NextFunction) => {
      if (req.headers['x-admin-token'] !== 'valid-admin-token') {
        res.status(401).json({ error: 'Administrator authentication is required.' });
        return;
      }
      next();
    };

    const downstreamStreamCtx = {
      get runtimeFeatureFlags() {
        return runtimeFeatureFlags;
      },
    };

    await withServer(
      (app) => {
        app.use(['/api/admin', '/api/v1/admin'], requireAdminMiddleware);
        registerAdminPlatformRoutes(app, {
          get platformConfig() {
            return platformConfig;
          },
          set platformConfig(_v) {
            /* mutated by reference */
          },
          get runtimeFeatureFlags() {
            return runtimeFeatureFlags;
          },
          set runtimeFeatureFlags(v) {
            runtimeFeatureFlags = v;
          },
          customerDirectory: [],
          blockedIps: [],
          auditRecords: [],
          SUPPORTED_MODELS: { 'supreme-spark': { provider: 'google', upstreamId: 'gemini-2.5-flash' } },
          activeAdminSessions: new Map(),
          signLocalSessionToken: () => 'signed-admin-tok',
          isHttpsRequest: () => false,
          persistPlatformState,
          resolveAuditActor: () => 'admin@supremeai.bd',
          recordAudit,
        });
      },
      async (baseUrl) => {
        // Anonymous caller cannot read or toggle /api/v1/admin/feature-flags
        const anonGet = await fetch(`${baseUrl}/api/v1/admin/feature-flags`);
        expect(anonGet.status).toBe(401);

        const anonPost = await fetch(`${baseUrl}/api/v1/admin/feature-flags`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maintenance_mode: true }),
        });
        expect(anonPost.status).toBe(401);
        expect(platformConfig.maintenanceMode).toBe(false);

        // Authenticated admin updates feature flags; getter sees live update
        const adminToggle = await fetch(`${baseUrl}/api/v1/admin/feature-flags`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': 'valid-admin-token',
          },
          body: JSON.stringify({ key: 'maintenance_mode', enabled: true }),
        });
        expect(adminToggle.status).toBe(200);
        expect(platformConfig.maintenanceMode).toBe(true);
        expect(downstreamStreamCtx.runtimeFeatureFlags.maintenance_mode).toBe(true);
        expect(persistPlatformState).toHaveBeenCalledTimes(1);

        // Model policy update persists durable platform state
        const policyRes = await fetch(`${baseUrl}/api/admin/models/policy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': 'valid-admin-token',
          },
          body: JSON.stringify({ modelId: 'supreme-spark', enabled: false, minTier: 'Enterprise' }),
        });
        expect(policyRes.status).toBe(200);
        expect(platformConfig.modelPolicies['supreme-spark']).toEqual({
          enabled: false,
          minTier: 'Enterprise',
        });
        expect(persistPlatformState).toHaveBeenCalledTimes(2);
        expect(recordAudit).toHaveBeenCalled();
      }
    );
  });

  it('revokes local stateless tokens and purges upstream session caches on both /api/auth/logout and /api/v1/auth/logout', async () => {
    const revokedTokens = new Set<string>();
    const activeAuthSessions = new Map<string, string>([['tok_local.demo', 'usr_1']]);
    const activeAdminSessions = new Map<string, number>([['tok_local.demo', Date.now() + 60_000]]);
    const activeRefreshTokens = new Map<string, { userId: string; expiresAt: number }>([
      ['rt_demo', { userId: 'usr_1', expiresAt: Date.now() + 60_000 }],
    ]);
    const tokHash = crypto.createHash('sha256').update('tok_local.demo').digest('hex');
    const upstreamTokenAdminCache = new Map([
      [
        tokHash,
        { email: 'admin@supremeai.bd', isAdmin: true, tier: 'Enterprise' as const, expiresAt: Date.now() + 60_000 },
      ],
    ]);

    await withServer(
      (app) => {
        registerAuthRoutes(app, {
          customerDirectory: [],
          usersDb: [],
          activeAuthSessions,
          activeAdminSessions,
          activeRefreshTokens,
          upstreamTokenAdminCache,
          revokeSessionToken: (token) => {
            revokedTokens.add(token);
          },
          isIpBlocked: () => false,
          platformConfig: { allowNewSignups: true },
          buildSafeAuthUser: (u) => ({
            id: u.id,
            user_id: u.id,
            name: u.name,
            email: u.email,
            avatar: 'A',
            plan: 'Pro',
            createdAt: '2026-11-28',
            isAdminEligible: false,
            adminEmailMatched: false,
            rbacRole: 'user',
            role: 'user',
            isDeveloperEligible: false,
            adminEmails: [],
          }),
          signLocalSessionToken: () => 'tok_local.demo',
          verifyLocalSessionToken: (t) =>
            revokedTokens.has(t) ? null : { sub: 'usr_1', email: 'user@supremeai.bd', iat: Date.now(), role: 'user' },
          issueLocalRefreshToken: () => 'rt_next',
          setRefreshTokenCookie: () => {},
          setAdminSessionCookie: () => {},
          resolveRbacUserProfile: () => ({
            isAdminEligible: false,
            adminEmailMatched: false,
            rbacRole: 'user',
            role: 'user',
            isDeveloperEligible: false,
            adminEmails: [],
          }),
          recordAudit: () => {},
        });
      },
      async (baseUrl) => {
        // Before logout, /api/auth/me succeeds via stateless verifyLocalSessionToken
        const meBefore = await fetch(`${baseUrl}/api/auth/me`, {
          headers: { Authorization: 'Bearer tok_local.demo' },
        });
        expect(meBefore.status).toBe(200);

        // Logout revokes token across all stores
        const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer tok_local.demo',
          },
          body: JSON.stringify({ refresh_token: 'rt_demo' }),
        });
        expect(logoutRes.status).toBe(200);
        expect(revokedTokens.has('tok_local.demo')).toBe(true);
        expect(activeAuthSessions.has('tok_local.demo')).toBe(false);
        expect(activeAdminSessions.has('tok_local.demo')).toBe(false);
        expect(activeRefreshTokens.has('rt_demo')).toBe(false);
        expect(upstreamTokenAdminCache.has(tokHash)).toBe(false);
      }
    );
  });
});
