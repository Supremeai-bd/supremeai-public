import type { Express, Request, Response } from 'express';
import { routeRateLimit } from '../routeRateLimit';
import { getPlanSpec, PLAN_CATALOG, TOPUP_PACKAGES } from '../../config/plans';
import type { PlanTier } from '../../types';

/**
 * Billing & Usage — `GET /api/billing/*` + `POST /api/billing/add-funds` + `GET /metrics/usage`
 *
 * WHY THIS FILE EXISTS
 *   Billing surface (wallet, plans, summary, history, top-up, metrics) lived
 *   inline in `server.ts` (~190 lines). All handlers share the same stores
 *   (wallet map, invoice store, daily usage map). Moving them keeps the
 *   monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `userWalletMap`, `userInvoiceOwner`, `userInvoicesStore`, `dailyUsageMap`,
 *     `ensureUserWallet` and all 6 route handlers are OWNED here (no other
 *     route reads these stores; `projects` previously shared file but not data).
 *   - `customerDirectory` + `usersDb` injected read-only for tier lookup inside
 *     `ensureUserWallet`.
 *   - `fetchGatewayJson`, `getRequestUserEmail`, `resolveAuthenticatedEmail`,
 *     `verifyAdminAuthorization`, `verifyBearerIdentity`, `recordAudit`,
 *     `resolveAuditActor` injected via ctx (closures over auth/gateway).
 */

interface UserWalletRecord {
  userId: string;
  balanceUsd: number;
  monthlyAllowanceUsd: number;
  totalSpent: number;
  totalSaved: number;
  cachedQueries: number;
}

interface CustomerEntry {
  id: string;
  email: string;
  tier?: PlanTier;
}

interface UsersDbEntry {
  id: string;
  email: string;
  plan?: PlanTier;
}

export interface BillingContext {
  get customerDirectory(): readonly CustomerEntry[];
  get usersDb(): readonly UsersDbEntry[];
  fetchGatewayJson: (pathAndQuery: string, ttlMs?: number) => Promise<any | null>;
  getRequestUserEmail: (req: Request) => string;
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
  verifyAdminAuthorization: (req: Request) => Promise<{ ok: boolean; status?: number; error?: string; email?: string }>;
  verifyBearerIdentity: (token: string) => Promise<{ email: string } | null>;
  recordAudit: (actor: string, action: string, resource: string, details: string, req: Request) => void;
  resolveAuditActor: (req: Request, actor?: unknown) => string;
}

export function registerBillingRoutes(app: Express, ctx: BillingContext): void {
  // Per-route throttle (CodeQL js/missing-rate-limiting): 120/min per IP per route.
  const billingRateLimit = routeRateLimit(120);

  const userWalletMap = new Map<string, UserWalletRecord>();
  const ensureUserWallet = (email: string): UserWalletRecord => {
    const existing = userWalletMap.get(email);
    if (existing) return existing;
    const customer = ctx.customerDirectory.find((c) => c.email.toLowerCase() === email);
    const matchedUser = ctx.usersDb.find((u) => u.email.toLowerCase() === email);
    const tier: PlanTier = (customer?.tier as PlanTier) || (matchedUser?.plan as PlanTier) || 'Free';
    const planSpec = getPlanSpec(tier);
    const monthlyAllowanceUsd = tier === 'Enterprise' ? 500 : tier === 'Pro' ? 100 : 0;
    const initial: UserWalletRecord = {
      userId: matchedUser?.id || customer?.id || (email === 'guest' ? 'guest' : `usr_${email}`),
      balanceUsd: planSpec.monthlyPriceUsd,
      monthlyAllowanceUsd,
      totalSpent: 0,
      totalSaved: 0,
      cachedQueries: 0,
    };
    userWalletMap.set(email, initial);
    return initial;
  };

  const userInvoiceOwner = new Map<string, string>();
  const userInvoicesStore: Array<{
    id: string;
    invoiceNumber: string;
    date: string;
    amountUsd: number;
    status: 'paid' | 'pending' | 'failed';
    planName: string;
    ownerEmail?: string;
  }> = [];

  const dailyUsageMap = new Map<
    string,
    {
      metric_date: string;
      total_requests: number;
      total_tokens: number;
      total_cost: number;
      unique_users: number;
      avg_latency_ms: number;
      error_rate: number;
    }
  >();

  // Dynamic Billing & Usage endpoints
  app.get('/api/billing/plans', billingRateLimit, async (_req: Request, res: Response) => {
    const remote = await ctx.fetchGatewayJson('/api/v1/billing/plans');
    const remotePlans = remote?.plans;
    const useRemote = remotePlans && typeof remotePlans === 'object' && !Array.isArray(remotePlans);
    if (useRemote) {
      res.json({
        plans: remotePlans,
        topupPackages:
          Array.isArray(remote?.topupPackages) || Array.isArray(remote?.topup_packages)
            ? remote?.topupPackages || remote?.topup_packages
            : TOPUP_PACKAGES,
        source: 'gateway',
      });
      return;
    }
    res.json({ plans: PLAN_CATALOG, topupPackages: TOPUP_PACKAGES, source: 'local' });
  });

  app.get('/api/billing/wallet', billingRateLimit, (req: Request, res: Response) => {
    const email = ctx.getRequestUserEmail(req);
    const wallet = ensureUserWallet(email);
    res.json({
      user_id: wallet.userId,
      balance_usd: wallet.balanceUsd,
      monthly_allowance_usd: wallet.monthlyAllowanceUsd,
      wallet: { balance: wallet.balanceUsd },
    });
  });

  app.get(['/api/billing/summary', '/api/billing/analytics'], billingRateLimit, (req: Request, res: Response) => {
    const email = ctx.getRequestUserEmail(req);
    const wallet = ensureUserWallet(email);
    res.json({
      total_spent: wallet.totalSpent,
      total_saved: wallet.totalSaved,
      cached_queries: wallet.cachedQueries,
    });
  });

  app.get('/api/billing/history', billingRateLimit, async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const adminAuth = await ctx.verifyAdminAuthorization(req);
    const list = adminAuth.ok
      ? userInvoicesStore
      : userInvoicesStore.filter(
          (inv) => (userInvoiceOwner.get(inv.id) || inv.ownerEmail || '') === owner
        );
    res.json({ invoices: list, history: list });
  });

  app.post('/api/billing/add-funds', billingRateLimit, async (req: Request, res: Response) => {
    const authHeader = String(req.headers.authorization || '').trim();
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const identity = bearerToken ? await ctx.verifyBearerIdentity(bearerToken) : null;
    const adminAuth = await ctx.verifyAdminAuthorization(req);

    if (!identity && !adminAuth.ok) {
      res.status(401).json({ error: 'Authentication required for billing operations.' });
      return;
    }

    const allowDirectTopup = process.env.ALLOW_DIRECT_BILLING_TOPUP === 'true';
    if (!adminAuth.ok && !allowDirectTopup) {
      res.status(403).json({
        error:
          'Verified payment checkout or administrator authorization is required to add account credits.',
      });
      return;
    }

    const email = (
      identity?.email ||
      (adminAuth.ok ? adminAuth.email : '') ||
      ctx.getRequestUserEmail(req)
    ).toLowerCase();
    if (!email || email === 'guest') {
      res.status(401).json({ error: 'Valid user account required for billing top-up.' });
      return;
    }

    const wallet = ensureUserWallet(email);
    const amount = Number(req.body?.amount);
    const tokens = Math.max(0, Math.floor(Number(req.body?.tokens) || 0));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) {
      res.status(400).json({ error: 'Funding amount must be between $0.01 and $10,000.' });
      return;
    }
    const callerAuth = await ctx.verifyAdminAuthorization(req);
    const invoiceStatus = callerAuth.ok ? ('paid' as const) : ('pending' as const);
    if (callerAuth.ok) {
      wallet.balanceUsd = Number((wallet.balanceUsd + amount).toFixed(2));
    }
    const invoice = {
      id: `inv_topup_${Date.now()}`,
      invoiceNumber: `TOP-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
      date: new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }),
      amountUsd: amount,
      status: invoiceStatus,
      planName:
        tokens > 0
          ? `Pay-As-You-Go Credits (${(tokens / 1_000_000).toFixed(2)}M Tokens)`
          : `Account Credit Top-up ($${amount})`,
      ownerEmail: email,
    };
    userInvoiceOwner.set(invoice.id, email);
    userInvoicesStore.unshift(invoice);
    ctx.recordAudit(
      ctx.resolveAuditActor(req),
      'BILLING_TOPUP',
      email,
      `Added $${amount} credit (${tokens} tokens)`,
      req
    );
    res.json({ success: true, invoice, balance_usd: wallet.balanceUsd });
  });

  app.get('/metrics/usage', billingRateLimit, async (req: Request, res: Response) => {
    const auth = await ctx.verifyAdminAuthorization(req);
    if (!auth.ok) {
      res.status(auth.status || 401).json({ error: auth.error || 'Admin authorization required.' });
      return;
    }
    const items = Array.from(dailyUsageMap.values());
    res.json({ items, total: items.length });
  });
}
