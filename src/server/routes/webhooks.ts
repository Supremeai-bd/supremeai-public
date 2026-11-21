import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { isRestrictedProxyTarget, resolveAndCheckProxyTarget } from '../../shared/serverSecurity';

/**
 * User Webhooks — `GET/POST/DELETE /api/user/webhooks*` + `POST /:id/test`
 *
 * WHY THIS FILE EXISTS
 *   Webhooks CRUD + test dispatch (4 handlers + `userWebhooksStore` + `userWebhookOwner`)
 *   lived inline in `server.ts` (~130 lines). Cohesive (single store, single
 *   SSRF-guarded dispatch) and has no other consumer. Moving it keeps the
 *   monolith shrinking.
 *
 * CONTRACT WITH server.ts
 *   - `userWebhooksStore` + `userWebhookOwner` are OWNED here (reassignment in
 *     DELETE is local; no other route reads webhooks).
 *   - `resolveAuthenticatedEmail` + `safeFetchWithRedirectCheck` are injected
 *     via ctx (closures over auth + SSRF guard, cannot be imported).
 *   - Shared SSRF helpers `isRestrictedProxyTarget`/`resolveAndCheckProxyTarget`
 *     are imported directly (pure functions).
 */

export interface WebhooksContext {
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
  safeFetchWithRedirectCheck: (
    initialUrl: string | URL,
    init?: RequestInit,
    isLocalRelative?: boolean,
    maxRedirects?: number
  ) => Promise<globalThis.Response>;
}

export function registerWebhooksRoutes(app: Express, ctx: WebhooksContext): void {
  const userWebhookOwner = new Map<string, string>();
  let userWebhooksStore: Array<{
    id: string;
    name: string;
    url: string;
    events: string[];
    secret: string;
    active: boolean;
    lastTriggered: string;
    failureCount: number;
  }> = [];

  app.get('/api/user/webhooks', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    res.json({
      webhooks: userWebhooksStore.filter((w) => (userWebhookOwner.get(w.id) || '') === owner),
    });
  });

  app.post('/api/user/webhooks', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = req.body || {};
    const rawUrl = String(body.url || '').trim();
    if (!rawUrl) {
      res.status(400).json({ error: 'Webhook URL is required.' });
      return;
    }
    try {
      const parsed = new URL(rawUrl);
      const targetCheck = isRestrictedProxyTarget(parsed, false);
      if (targetCheck.restricted) {
        res.status(400).json({ error: targetCheck.reason || 'Restricted webhook destination.' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid webhook URL.' });
      return;
    }
    const created = {
      id: `wh_${Date.now()}`,
      name: String(body.name || rawUrl).trim(),
      url: rawUrl,
      events:
        Array.isArray(body.events) && body.events.length > 0 ? body.events : ['chat.completed'],
      secret: String(body.secret || `whsec_${crypto.randomBytes(12).toString('hex')}`),
      active: body.active ?? true,
      lastTriggered: 'Never',
      failureCount: 0,
    };
    userWebhooksStore.unshift(created);
    userWebhookOwner.set(created.id, owner);
    res.status(201).json({
      success: true,
      webhook: created,
      webhooks: userWebhooksStore.filter((w) => (userWebhookOwner.get(w.id) || '') === owner),
    });
  });

  app.delete('/api/user/webhooks/:id', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    if ((userWebhookOwner.get(req.params.id) || '') !== owner) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    userWebhookOwner.delete(req.params.id);
    userWebhooksStore = userWebhooksStore.filter((w) => w.id !== req.params.id);
    res.json({
      success: true,
      webhooks: userWebhooksStore.filter((w) => (userWebhookOwner.get(w.id) || '') === owner),
    });
  });

  app.post('/api/user/webhooks/:id/test', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const target = userWebhooksStore.find((w) => w.id === req.params.id);
    if (!target || (userWebhookOwner.get(req.params.id) || '') !== owner) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    let parsedWebhookUrl: URL;
    try {
      parsedWebhookUrl = new URL(target.url);
      const targetCheck = await resolveAndCheckProxyTarget(parsedWebhookUrl, false);
      if (targetCheck.restricted) {
        res.status(400).json({ error: targetCheck.reason || 'Restricted webhook destination.' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Invalid webhook URL.' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const hookRes = await ctx.safeFetchWithRedirectCheck(
        parsedWebhookUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-SupremeAI-Signature': target.secret },
          body: JSON.stringify({ event: 'webhook.test', timestamp: new Date().toISOString() }),
          signal: controller.signal,
        },
        false
      );
      clearTimeout(timeout);
      target.lastTriggered = `${new Date().toLocaleTimeString()} (HTTP ${hookRes.status})`;
      if (!hookRes.ok) target.failureCount += 1;
      res.json({ success: hookRes.ok, status_code: hookRes.status });
    } catch (err: unknown) {
      target.lastTriggered = `${new Date().toLocaleTimeString()} (Failed)`;
      target.failureCount += 1;
      res.json({
        success: false,
        status_code: 0,
        error: err instanceof Error ? err.message : 'Delivery failed',
      });
    }
  });
}
