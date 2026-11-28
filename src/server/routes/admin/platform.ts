import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import {
  collectLiveServiceHealth,
  getRealGatewayTrafficSummary,
  sampleHostRuntime,
} from '../../mcpHealthCollector';
import type { PlanTier } from '../../../types';
import { ADMIN_SESSION_TTL_MS } from '../../../shared/serverSecurity';
import { adminPasskeySchema, parseBody } from '../../validation';

/**
 * Admin Platform — auth verify + platform config + overview + feature flags + model policy
 *
 * WHY THIS FILE EXISTS
 *   These 6 admin routes + 1 public platform config read were the densest
 *   part of the remaining monolith (auth verify touches session signing,
 *   overview aggregates live health/traffic/customer metrics, feature-flags
 *   mutates runtimeFeatureFlags). They close over the same handful of
 *   shared governance state (platformConfig, runtimeFeatureFlags, etc.),
 *   so grouping them avoids scattering the maintenance-mode/announcement
 *   logic across files.
 *
 * CONTRACT WITH server.ts
 *   - `platformConfig` is passed by object reference — property mutations
 *     (`platformConfig.maintenanceMode = ...`) are visible without a setter.
 *   - `runtimeFeatureFlags` is passed via getter/setter because it is
 *     reassigned (`runtimeFeatureFlags = { ... }`) in feature-flags POST.
 *   - `activeAdminSessions`, `signLocalSessionToken`, `isHttpsRequest` are
 *     function/store deps that live inside the bootstrap closure and cannot
 *     be imported, so they are injected via ctx.
 *   - `SUPPORTED_MODELS` is passed via ctx (top-level const in server.ts).
 *   - All other shared stores (customerDirectory, blockedIps, auditRecords)
 *     are read-only here, so they are passed as live array references.
 *   - Registration order is preserved — server.ts calls this exactly where
 *     the inline block sat, so Express precedence is unchanged.
 */

export interface AdminPlatformContext {
  platformConfig: Record<string, unknown> & {
    maintenanceMode: boolean;
    maintenanceMessage: string;
    announcementBanner: Record<string, unknown> & { active: boolean };
    allowNewSignups: boolean;
    defaultModelId: string;
    modelPolicies: Record<string, { enabled: boolean; minTier: PlanTier }>;
  };
  runtimeFeatureFlags: Record<string, boolean>;
  customerDirectory: unknown[];
  blockedIps: unknown[];
  auditRecords: unknown[];
  SUPPORTED_MODELS: Record<string, unknown>;
  activeAdminSessions: Map<string, number>;
  signLocalSessionToken: (
    payload: Record<string, unknown>,
    ttlMs: number,
  ) => string;
  isHttpsRequest: (req: Request) => boolean;
  persistPlatformState: () => void;
  resolveAuditActor: (req?: Request, explicitActor?: unknown) => string;
  recordAudit: (
    actor: string,
    action: string,
    resource: string,
    details: string,
    req?: Request,
  ) => unknown;
}

export function registerAdminPlatformRoutes(app: Express, ctx: AdminPlatformContext): void {
  // POST /api/admin/auth/verify - Validate Admin Key/Passcode
  app.post('/api/admin/auth/verify', (req: Request, res: Response) => {
    const validPass = process.env.ADMIN_PASSKEY;

    if (!validPass) {
      res.status(503).json({
        success: false,
        authenticated: false,
        error: 'Admin access is not configured. Set ADMIN_PASSKEY in the environment.',
      });
      return;
    }

    const parsed = parseBody(adminPasskeySchema, req, res);
    if (!parsed.ok) return;
    const { passkey } = parsed.data;

    const a = Buffer.from(String(passkey ?? ''));
    const b = Buffer.from(validPass);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      const operator = ctx.resolveAuditActor(req, 'Admin Operator');
      const adminToken = ctx.signLocalSessionToken(
        {
          sub: 'admin_passkey',
          email: operator.includes('@') ? operator.toLowerCase() : 'admin@supremeai.bd',
          iat: Date.now(),
          role: 'admin',
        },
        ADMIN_SESSION_TTL_MS,
      );
      ctx.activeAdminSessions.set(adminToken, Date.now() + ADMIN_SESSION_TTL_MS);
      res.cookie('supremeai_admin_session', adminToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: ctx.isHttpsRequest(req),
        path: '/api/admin',
        maxAge: ADMIN_SESSION_TTL_MS,
      });
      res.json({
        success: true,
        authenticated: true,
        role: 'admin',
        token: adminToken,
        operator,
      });
    } else {
      res.status(401).json({
        success: false,
        authenticated: false,
        error: 'Invalid administrator passkey. Access denied.',
      });
    }
  });

  // Admin: update platform config (maintenance, announcement banner, signup toggle, default model)
  app.post('/api/admin/config', (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const changedFields: string[] = [];

    if (typeof body.maintenanceMode === 'boolean') {
      ctx.platformConfig.maintenanceMode = body.maintenanceMode as boolean;
      ctx.runtimeFeatureFlags.maintenance_mode = body.maintenanceMode as boolean;
      changedFields.push(`maintenanceMode=${body.maintenanceMode}`);
    }
    if (typeof body.maintenanceMessage === 'string') {
      ctx.platformConfig.maintenanceMessage = body.maintenanceMessage as string;
      changedFields.push('maintenanceMessage');
    }
    if (body.announcementBanner && typeof body.announcementBanner === 'object') {
      ctx.platformConfig.announcementBanner = {
        ...(ctx.platformConfig.announcementBanner as unknown as Record<string, unknown>),
        ...(body.announcementBanner as Record<string, unknown>),
      } as Record<string, unknown> & { active: boolean };
      changedFields.push(`banner(${(ctx.platformConfig.announcementBanner as { active: boolean }).active ? 'active' : 'off'})`);
    }
    if (typeof body.allowNewSignups === 'boolean') {
      ctx.platformConfig.allowNewSignups = body.allowNewSignups as boolean;
      changedFields.push(`allowNewSignups=${body.allowNewSignups}`);
    }
    if (
      typeof body.defaultModelId === 'string' &&
      ctx.SUPPORTED_MODELS[body.defaultModelId as string]
    ) {
      ctx.platformConfig.defaultModelId = body.defaultModelId as string;
      changedFields.push(`defaultModel=${body.defaultModelId}`);
    }

    if (changedFields.length > 0) {
      ctx.persistPlatformState();
      ctx.recordAudit(
        ctx.resolveAuditActor(req, body.actor),
        'PLATFORM_CONFIG_UPDATE',
        'Platform Control Plane',
        `Updated: ${changedFields.join(', ')}`,
        req,
      );
    }

    res.json({
      success: true,
      config: {
        ...ctx.platformConfig,
        featureFlags: ctx.runtimeFeatureFlags,
      },
    });
  });

  // GET /api/admin/overview - Real-time live metrics for Admin Command Center
  app.get('/api/admin/overview', async (_req: Request, res: Response) => {
    const [healthSnap] = await Promise.all([collectLiveServiceHealth(false).catch(() => null)]);
    const traffic = getRealGatewayTrafficSummary();
    const host = sampleHostRuntime();
    const customers = ctx.customerDirectory as Array<{ mrr: number; status: string }>;
    const totalMrr = customers.reduce((sum, c) => sum + (c.mrr as number), 0);
    const activeCustomers = customers.filter((c) => c.status === 'active').length;

    res.json({
      summary: {
        totalUsers: customers.length,
        activeCustomers,
        suspendedCustomers: customers.filter((c) => c.status === 'suspended').length,
        totalMrr,
        gatewayRpm: traffic.rpm,
        totalRequestsObserved: traffic.totalRequests,
        avgLatencyMs: (healthSnap as { summary: { avgLatencyMs: number } } | null)?.summary.avgLatencyMs ?? traffic.avgLatencyMs,
        errorRatePercent: traffic.errorRatePercent,
        healthyServices: (healthSnap as { summary: { healthy: number } } | null)?.summary.healthy ?? 0,
        unhealthyServices:
          ((healthSnap as { summary: { degraded: number } } | null)?.summary.degraded ?? 0) +
          ((healthSnap as { summary: { critical: number } } | null)?.summary.critical ?? 0) +
          ((healthSnap as { summary: { unreachable: number } } | null)?.summary.unreachable ?? 0),
        totalServices: (healthSnap as { summary: { total: number } } | null)?.summary.total ?? 0,
        blockedIpCount: ctx.blockedIps.length,
        auditCount: ctx.auditRecords.length,
        hostCpuPercent: host.cpuPercent,
        hostMemUsedPct: host.systemMemUsedPct,
        hostProcessRssMb: host.processRssMb,
        uptimeSec: host.uptimeSec,
      },
      trafficHistory: traffic.history,
      hostHistory: (healthSnap as { hostHistory: unknown[] } | null)?.hostHistory || [],
      featureFlags: ctx.runtimeFeatureFlags,
      platformConfig: ctx.platformConfig,
    });
  });

  // GET & POST /api/admin/feature-flags (plus /api/v1 alias used by adminService)
  app.get(
    ['/api/admin/feature-flags', '/api/v1/admin/feature-flags'],
    (_req: Request, res: Response) => {
      const flags = Object.entries(ctx.runtimeFeatureFlags).map(([name, enabled]) => ({
        name,
        enabled,
      }));
      res.json({ flags, flagsRecord: ctx.runtimeFeatureFlags });
    },
  );

  app.post(
    ['/api/admin/feature-flags', '/api/v1/admin/feature-flags'],
    (req: Request, res: Response) => {
      const body = req.body as Record<string, unknown>;
      const updates: Record<string, boolean> = {};

      if (typeof body.key === 'string' && typeof body.enabled === 'boolean') {
        updates[body.key as string] = body.enabled as boolean;
      } else if (typeof body.name === 'string' && typeof body.enabled === 'boolean') {
        updates[body.name as string] = body.enabled as boolean;
      } else {
        for (const [k, v] of Object.entries(body)) {
          if (typeof v === 'boolean') {
            updates[k] = v;
          }
        }
      }

      // Reassignment via ctx setter — keeps the original `let runtimeFeatureFlags`
      // binding in server.ts coherent. Object.assign would keep the same
      // reference but the original code intentionally replaces the object.
      ctx.runtimeFeatureFlags = { ...ctx.runtimeFeatureFlags, ...updates };
      if (typeof updates.maintenance_mode === 'boolean') {
        ctx.platformConfig.maintenanceMode = updates.maintenance_mode;
      }
      ctx.persistPlatformState();

      const summary = Object.entries(updates)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      if (summary) {
        ctx.recordAudit(
          ctx.resolveAuditActor(req, body.actor),
          'FEATURE_FLAG_TOGGLE',
          'Runtime Flags',
          `Updated ${summary}`,
          req,
        );
      }

      const flagList = Object.entries(ctx.runtimeFeatureFlags).map(([name, enabled]) => ({
        name,
        enabled,
      }));
      res.json({
        success: true,
        flag: flagList.find((f) => f.name in updates) || flagList[0],
        flags: flagList,
        flagsRecord: ctx.runtimeFeatureFlags,
        platformConfig: ctx.platformConfig,
      });
    },
  );

  // POST /api/admin/models/policy - Enable/disable models and restrict min tier
  app.post('/api/admin/models/policy', (req: Request, res: Response) => {
    const { modelId, enabled, minTier } = req.body as Record<string, unknown>;
    if (!modelId || !ctx.SUPPORTED_MODELS[modelId as string]) {
      res.status(400).json({ error: 'Valid modelId is required.' });
      return;
    }

    const prev = (ctx.platformConfig.modelPolicies as Record<string, { enabled: boolean; minTier: PlanTier }>)[modelId as string] || {
      enabled: true,
      minTier: 'Free' as PlanTier,
    };
    (ctx.platformConfig.modelPolicies as Record<string, { enabled: boolean; minTier: PlanTier }>)[modelId as string] = {
      enabled: typeof enabled === 'boolean' ? (enabled as boolean) : prev.enabled,
      minTier:
        minTier === 'Free' || minTier === 'Pro' || minTier === 'Enterprise'
          ? (minTier as PlanTier)
          : prev.minTier,
    };
    // বাংলা মন্তব্য: সার্ভার রিস্টার্টের পরও মডেল পলিসি অক্ষত রাখতে প্ল্যাটফর্ম স্টেট পারসিস্ট করা হচ্ছে
    ctx.persistPlatformState();

    ctx.recordAudit(
      ctx.resolveAuditActor(req, (req.body as Record<string, unknown>)?.actor),
      'MODEL_POLICY_UPDATE',
      `Model: ${modelId}`,
      `enabled=${(ctx.platformConfig.modelPolicies as Record<string, { enabled: boolean; minTier: PlanTier }>)[modelId as string].enabled}, minTier=${(ctx.platformConfig.modelPolicies as Record<string, { enabled: boolean; minTier: PlanTier }>)[modelId as string].minTier}`,
      req,
    );

    res.json({ success: true, modelPolicies: ctx.platformConfig.modelPolicies });
  });
}
