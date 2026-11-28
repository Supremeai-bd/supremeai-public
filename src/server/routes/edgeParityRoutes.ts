import type { Express, NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import {
  resolveUpstreamOrigin,
  verifyUpstreamSession,
  type PagesContext,
  type UpstreamSessionVerification,
} from '../../../functions/_lib/edgeHelpers';
import { handleAdminAlertsRoute } from '../../../functions/_lib/adminAlerts';
import { handleAdminBackupsRoute } from '../../../functions/_lib/adminBackups';
import { handleAdminFinOpsRoute } from '../../../functions/_lib/adminFinOps';
import { handleAdminModelRouterRoute } from '../../../functions/_lib/adminModelRouter';
import { handleAdminPackagesRoute } from '../../../functions/_lib/creditPackages';
import { handleAdminRealDataRoute } from '../../../functions/_lib/adminRealDataRoutes';
import { handleAdminSessionsRoute } from '../../../functions/_lib/adminSessions';
import { handleAdminTeamRoute } from '../../../functions/_lib/adminTeam';
import { handleUserMemoriesRequest } from '../../../functions/_lib/userMemories';
import { onRequest as handlePoolRequest } from '../../../functions/api/pool/[[path]]';
import { onRequest as handleDeepResearchRequest } from '../../../functions/api/research/deep';
import { onRequest as handleResearchPathRequest } from '../../../functions/api/research/[[path]]';
import { routeRateLimit } from '../httpGuards';
import type { PlanTier } from '../platformState';

export interface EdgeParityRoutesContext {
  verifyBearerIdentity: (
    rawToken: string
  ) => Promise<{ email: string; isAdmin: boolean; tier: PlanTier; userId?: string } | null>;
  resolveAuditActor: (req?: ExpressRequest, explicitActor?: unknown) => string;
  recordAudit: (
    actor: string,
    action: string,
    resource: string,
    details: string,
    req?: ExpressRequest
  ) => unknown;
}

function toWebRequest(req: ExpressRequest): Request {
  const proto = req.protocol || 'http';
  const host = req.get('host') || 'localhost';
  const url = `${proto}://${host}${req.originalUrl || req.url}`;
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (Array.isArray(val)) {
      for (const item of val) headers.append(key, item);
    } else if (typeof val === 'string') {
      headers.set(key, val);
    }
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body =
    hasBody && req.body !== undefined
      ? typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body)
      : undefined;
  return new Request(url, { method: req.method, headers, body });
}

async function sendWebResponse(res: ExpressResponse, webRes: Response): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (lower !== 'content-length' && lower !== 'transfer-encoding') {
      res.setHeader(key, val);
    }
  });
  res.send(Buffer.from(await webRes.arrayBuffer()));
}

/**
 * Mounts Cloudflare Edge-native Web-standard handlers (`functions/_lib/*` and
 * `functions/api/{pool,research,user/memories}`) directly onto the Node Express
 * server so Local Dev, Desktop (Tauri), and Android share 100% route parity
 * without duplicating a single line of business logic.
 */
export function registerEdgeParityRoutes(app: Express, ctx: EdgeParityRoutesContext): void {
  const getEnv = (): NonNullable<PagesContext['env']> =>
    process.env as Record<string, string | undefined>;

  const verifyNodeOrUpstreamSession = async (
    request: Request,
    upstreamOrigin: string
  ): Promise<UpstreamSessionVerification> => {
    const authHeader = (request.headers.get('Authorization') || '').trim();
    const keyHeader = (request.headers.get('X-SupremeAI-Key') || '').trim();
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : keyHeader;
    if (token) {
      const local = await ctx.verifyBearerIdentity(token);
      if (local?.email) {
        return {
          valid: true,
          isGuest: false,
          role: local.isAdmin ? 'admin' : 'user',
          email: local.email,
          user_id: local.userId || local.email,
        };
      }
    }
    return verifyUpstreamSession(request, upstreamOrigin);
  };

  app.use(
    '/api/pool',
    routeRateLimit(120, { scope: 'area' }),
    async (req: ExpressRequest, res: ExpressResponse) => {
      const webRes = await handlePoolRequest(
        { request: toWebRequest(req), env: getEnv() },
        verifyNodeOrUpstreamSession
      );
      await sendWebResponse(res, webRes);
    }
  );

  app.use(
    '/api/user/memories',
    routeRateLimit(120, { scope: 'area' }),
    async (req: ExpressRequest, res: ExpressResponse) => {
      const env = getEnv();
      const upstreamOrigin = resolveUpstreamOrigin(env);
      const webRes = await handleUserMemoriesRequest(toWebRequest(req), env, {
        verify: (r) => verifyNodeOrUpstreamSession(r, upstreamOrigin),
      });
      await sendWebResponse(res, webRes);
    }
  );

  app.all(
    '/api/research/deep',
    routeRateLimit(30, { scope: 'area' }),
    async (req: ExpressRequest, res: ExpressResponse) => {
      const webRes = await handleDeepResearchRequest({ request: toWebRequest(req), env: getEnv() });
      await sendWebResponse(res, webRes);
    }
  );

  app.use(
    '/api/research',
    routeRateLimit(60, { scope: 'area' }),
    async (req: ExpressRequest, res: ExpressResponse) => {
      const webRes = await handleResearchPathRequest({ request: toWebRequest(req), env: getEnv() });
      await sendWebResponse(res, webRes);
    }
  );

  // Admin Supabase-backed routes (`app.use('/api/admin', requireAdminMiddleware)` already verified RBAC)
  app.use(
    '/api/admin',
    routeRateLimit(600, { scope: 'area' }),
    async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const env = getEnv();
    const webReq = toWebRequest(req);
    const path = new URL(webReq.url).pathname.replace(/\/+$/, '');
    const audit: { actor: string; details?: string } = { actor: ctx.resolveAuditActor(req) };
    const upstreamOrigin = resolveUpstreamOrigin(env);

    const matched =
      (await handleAdminTeamRoute(path, webReq, env, audit)) ??
      (await handleAdminModelRouterRoute(path, webReq, env, audit)) ??
      (await handleAdminBackupsRoute(path, webReq, env)) ??
      (await handleAdminFinOpsRoute(path, webReq, env, audit)) ??
      (await handleAdminSessionsRoute(path, webReq, env, audit)) ??
      (await handleAdminAlertsRoute(path, webReq, env, audit)) ??
      (await handleAdminPackagesRoute(path, webReq, env, audit)) ??
      (path === '/api/admin/connections'
        ? await handleAdminRealDataRoute(path, webReq, env, upstreamOrigin)
        : null);

    if (!matched) {
      next();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && audit.details) {
      ctx.recordAudit(audit.actor, `${req.method} ${path}`, path, audit.details, req);
    }
    await sendWebResponse(res, matched);
  });
}
