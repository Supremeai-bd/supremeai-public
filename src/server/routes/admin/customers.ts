import type { Express, Request, Response } from 'express';
import { getPlanSpec } from '../../../config/plans';
import type { PlanTier } from '../../../types';

/**
 * Admin Customers — Customer Directory CRUD (live Supabase + local snapshot)
 *
 * WHY THIS FILE EXISTS
 *   `server.ts` grew to 11.5k lines with 39 admin route handlers in one
 *   function scope. The customer directory (GET/POST/PATCH/DELETE) is a
 *   cohesive read/write surface that touches only 7 shared names.
 *   Moving it out keeps the monolith shrinking while the split plan
 *   (docs/SERVER_TS_SPLIT_PLAN.md) progresses group by group.
 *
 * CONTRACT WITH server.ts
 *   Only shared mutable state and helpers are passed via `ctx`. The two
 *   Supabase helpers are intentionally owned here — they are used exclusively
 *   by this surface, so duplicating them would be waste, and importing them
 *   from the monolith would recreate the coupling this split removes.
 *   Mutations to `customerDirectory`/`usersDb` that originally used
 *   reassignment (`arr = arr.filter(...)`) are performed via the ctx
 *   getter/setter pair so the original `let` binding in server.ts stays
 *   in sync (Express registration order is unchanged — server.ts calls this
 *   exactly where the inline block used to sit).
 */

type RbacRole = 'admin' | 'super_admin' | 'developer' | 'user';

interface ServerCustomerRecord {
  id: string;
  name: string;
  email: string;
  tier: PlanTier;
  status: 'active' | 'past_due' | 'suspended';
  mrr: number;
  tokensUsed: number;
  tokenLimit: number;
  connectedRepos: number;
  joinedDate: string;
  lastActive: string;
  githubHandle?: string;
  region: string;
  isDeveloperEligible: boolean;
  isAdminEligible?: boolean;
  rbacRole?: RbacRole;
}

interface ServerUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  rbacRole?: RbacRole;
  isAdminEligible: boolean;
  isDeveloperEligible: boolean;
  adminUserId?: string;
  plan: PlanTier;
  createdAt: string;
  avatar?: string;
}

export interface AdminCustomersContext {
  customerDirectory: ServerCustomerRecord[];
  usersDb: ServerUser[];
  resolveAuditActor: (req?: Request, explicitActor?: unknown) => string;
  recordAudit: (
    actor: string,
    action: string,
    resource: string,
    details: string,
    req?: Request,
  ) => unknown;
}

const fetchSupabaseLiveUsers = async (): Promise<ServerCustomerRecord[] | null> => {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/auth/v1/admin/users?per_page=50`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const users: unknown[] = Array.isArray((data as { users?: unknown[] })?.users)
      ? (data as { users: unknown[] }).users
      : [];
    return users.map((uRaw, idx) => {
      const u = uRaw as Record<string, unknown>;
      const meta = (u.user_metadata as Record<string, unknown>) || {};
      const appMeta = (u.app_metadata as Record<string, unknown>) || {};
      return {
        id: String((u as { id?: unknown }).id || `u_${idx}`),
        name:
          String(meta.full_name || meta.name || '').trim() ||
          String((u as { email?: unknown }).email || '').split('@')[0] ||
          `User ${idx + 1}`,
        email: String((u as { email?: unknown }).email || 'unknown@user'),
        tier: String(appMeta.tier || meta.plan || 'Free') as PlanTier,
        status: (u as { banned_until?: unknown }).banned_until ? 'suspended' : 'active',
        mrr:
          appMeta.tier === 'Enterprise' ? 299 : appMeta.tier === 'Pro' ? 29 : 0,
        tokensUsed: Number(appMeta.tokens_used || 0),
        tokenLimit: Number(appMeta.token_limit || 1000000),
        connectedRepos: Number(meta.connected_repos || 0),
        joinedDate: (u as { created_at?: string }).created_at
          ? String((u as { created_at?: string }).created_at).slice(0, 10)
          : '2026-01-01',
        lastActive: (u as { last_sign_in_at?: string }).last_sign_in_at
          ? new Date(String((u as { last_sign_in_at?: string }).last_sign_in_at)).toLocaleDateString()
          : 'Never',
        region: String(meta.region || 'Global'),
        isDeveloperEligible: Boolean(appMeta.is_developer || meta.is_developer),
        isAdminEligible: Boolean(appMeta.is_admin || meta.is_admin),
      } as ServerCustomerRecord;
    });
  } catch {
    return null;
  }
};

export function registerAdminCustomerRoutes(app: Express, ctx: AdminCustomersContext): void {
  // We keep mutable refs via ctx accessors: setters update the original `let`
  // bindings in server.ts, so a reassignment like `filter` stays coherent.
  // To avoid accidental shadowing, never destructure customerDirectory/usersDb
  // as plain values — always read/write through ctx.

  app.get('/api/admin/customers', async (_req: Request, res: Response) => {
    const liveUsers = await fetchSupabaseLiveUsers();
    if (liveUsers && liveUsers.length > 0) {
      res.json({ customers: liveUsers, provenance: 'live-supabase', configured: true });
      return;
    }
    const hasSupabase = Boolean(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
    res.json({
      customers: ctx.customerDirectory,
      provenance: 'local-snapshot',
      configured: hasSupabase,
    });
  });

  app.post('/api/admin/customers', (req: Request, res: Response) => {
    const body: Record<string, unknown> = (req.body as Record<string, unknown>) || {};
    if (!body.name || !body.email) {
      res.status(400).json({ error: 'Customer name and email are required.' });
      return;
    }
    const tier: PlanTier =
      body.tier === 'Enterprise' || body.tier === 'Free' ? (body.tier as PlanTier) : 'Pro';
    const planSpec = getPlanSpec(tier);
    const newCust: ServerCustomerRecord = {
      id: `cust_${String(Date.now()).slice(-4)}`,
      name: String(body.name).trim(),
      email: String(body.email).trim().toLowerCase(),
      tier,
      status:
        body.status === 'suspended' || body.status === 'past_due'
          ? (body.status as ServerCustomerRecord['status'])
          : 'active',
      mrr: typeof body.mrr === 'number' ? (body.mrr as number) : planSpec.monthlyPriceUsd,
      tokensUsed: typeof body.tokensUsed === 'number' ? (body.tokensUsed as number) : 0,
      tokenLimit:
        typeof body.tokenLimit === 'number'
          ? (body.tokenLimit as number)
          : planSpec.monthlyTokensLimit,
      connectedRepos:
        typeof body.connectedRepos === 'number' ? (body.connectedRepos as number) : 0,
      joinedDate: new Date().toISOString().slice(0, 10),
      lastActive: 'Just now',
      githubHandle: body.githubHandle as string | undefined,
      region: (body.region as string) || 'Global',
      isDeveloperEligible: Boolean(body.isDeveloperEligible || body.isAdminEligible),
      isAdminEligible: Boolean(
        body.isAdminEligible || body.rbacRole === 'admin' || body.rbacRole === 'super_admin',
      ),
      rbacRole:
        (body.rbacRole as RbacRole) ||
        (body.isAdminEligible ? 'admin' : body.isDeveloperEligible ? 'developer' : 'user'),
    };
    ctx.customerDirectory.unshift(newCust);
    ctx.recordAudit(
      ctx.resolveAuditActor(req, body.actor),
      'CUSTOMER_CREATE',
      `Customer: ${newCust.email}`,
      `Created ${newCust.tier} account (${newCust.status})`,
      req,
    );
    res.json({ success: true, customer: newCust, customers: ctx.customerDirectory });
  });

  app.patch('/api/admin/customers/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const idx = ctx.customerDirectory.findIndex((c) => c.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    const updates: Record<string, unknown> = (req.body as Record<string, unknown>) || {};
    ctx.customerDirectory[idx] = { ...ctx.customerDirectory[idx], ...(updates as Partial<ServerCustomerRecord>) };
    if (
      typeof updates.isDeveloperEligible === 'boolean' ||
      typeof updates.isAdminEligible === 'boolean' ||
      typeof updates.rbacRole === 'string'
    ) {
      const targetEmail = ctx.customerDirectory[idx].email.toLowerCase();
      const nextAdmin =
        typeof updates.isAdminEligible === 'boolean'
          ? (updates.isAdminEligible as boolean)
          : updates.rbacRole === 'admin' || updates.rbacRole === 'super_admin'
            ? true
            : undefined;
      // Reassignment via setter — keeps server.ts `let usersDb` binding in sync.
      ctx.usersDb = ctx.usersDb.map((u) =>
        u.email.toLowerCase() === targetEmail
          ? {
              ...u,
              ...(typeof updates.isDeveloperEligible === 'boolean'
                ? { isDeveloperEligible: updates.isDeveloperEligible as boolean }
                : {}),
              ...(typeof nextAdmin === 'boolean'
                ? {
                    isAdminEligible: nextAdmin,
                    role: nextAdmin ? 'admin' : 'user',
                    rbacRole: nextAdmin ? 'admin' : u.isDeveloperEligible ? 'developer' : 'user',
                    isDeveloperEligible: nextAdmin || u.isDeveloperEligible,
                  }
                : {}),
              ...(typeof updates.rbacRole === 'string'
                ? { rbacRole: updates.rbacRole as RbacRole }
                : {}),
            }
          : u,
      );
    }
    ctx.recordAudit(
      ctx.resolveAuditActor(req, updates.actor),
      'CUSTOMER_UPDATE',
      `Customer: ${ctx.customerDirectory[idx].email}`,
      `Updated ${Object.keys(updates).join(', ')}`,
      req,
    );
    res.json({
      success: true,
      customer: ctx.customerDirectory[idx],
      customers: ctx.customerDirectory,
    });
  });

  app.delete('/api/admin/customers/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const target = ctx.customerDirectory.find((c) => c.id === id);
    if (!target) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    ctx.customerDirectory = ctx.customerDirectory.filter((c) => c.id !== id);
    ctx.recordAudit(
      ctx.resolveAuditActor(req),
      'CUSTOMER_DELETE',
      `Customer: ${target.email}`,
      'Removed customer record from platform directory',
      req,
    );
    res.json({ success: true, customers: ctx.customerDirectory });
  });
}
