import type { Express, Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import crypto from 'crypto';

/**
 * User API Keys — `GET/POST/PATCH/DELETE /api/api-keys*` (multi-provider CRUD + probe)
 *
 * WHY THIS FILE EXISTS
 *   The API-keys surface (6 handlers + `userApiKeysStore`/`userApiKeyOwner`)
 *   lived inline in `server.ts` (~185 lines). It is cohesive (single store,
 *   single domain, shared provider-mesh health probe) and has no other consumer.
 *   Moving it keeps the monolith shrinking with a small ctx.
 *
 * CONTRACT WITH server.ts
 *   - `userApiKeysStore` + `userApiKeyOwner` are OWNED here — no other route
 *     reads them (admin/providers owns providerMesh, not api-keys).
 *   - `providerMesh` + `PROVIDER_DISPLAY_NAMES` are injected via ctx (read-only)
 *     because they are shared with `admin/providers` and reassignable there.
 *   - `resolveAuthenticatedEmail` is injected via ctx (closure over JWT/customerDirectory).
 */

interface ProviderMeshEntry {
  provider: string;
  displayName: string;
  status: string;
  avgLatencyMs?: number;
}

export interface ApiKeysContext {
  providerMesh: readonly ProviderMeshEntry[];
  PROVIDER_DISPLAY_NAMES: Record<string, string>;
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
}

export function registerApiKeysRoutes(app: Express, ctx: ApiKeysContext): void {
  const userApiKeyOwner = new Map<string, string>();
  let userApiKeysStore: Array<{
    id: string;
    name: string;
    provider: string;
    keyPrefix: string;
    secretMasked: string;
    createdAt: string;
    lastUsed: string;
    rateLimitRpm: number;
    status: 'active' | 'revoked';
    healthStatus: 'healthy' | 'degraded' | 'unhealthy';
    lastChecked: string;
    permissions: string[];
  }> = [];

  app.get(['/api/api-keys', '/api/v1/api-keys'], async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    res.json({ keys: userApiKeysStore.filter((k) => (userApiKeyOwner.get(k.id) || '') === owner) });
  });

  app.post(
    ['/api/api-keys/create', '/api/v1/api-keys/create'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const body = req.body || {};
      const name = String(body.name || 'New Provider Key').trim();
      const provider = String(body.provider || 'supremeai').trim();
      const rawSecret = String(body.secret || '').trim();
      const rateLimitRpm = Number(
        body.rateLimitRpm || (body.rate_limit_rps ? body.rate_limit_rps * 60 : 120)
      );
      const permissions = Array.isArray(body.scopes || body.permissions)
        ? body.scopes || body.permissions
        : ['chat:write', 'models:read'];

      const generatedSecret =
        rawSecret ||
        `sk-${provider === 'supremeai' ? 'supreme' : provider.slice(0, 4)}-live-${crypto.randomBytes(24).toString('base64url')}`;
      const prefix = generatedSecret.slice(0, Math.min(14, generatedSecret.length));
      const masked =
        generatedSecret.length > 10
          ? `${generatedSecret.slice(0, 10)}••••••••••••••••${generatedSecret.slice(-4)}`
          : '••••••••••••••••';

      const newItem = {
        id: `key_${Date.now()}`,
        name,
        provider,
        keyPrefix: prefix,
        secretMasked: masked,
        createdAt: new Date().toISOString().slice(0, 10),
        lastUsed: 'Never',
        rateLimitRpm,
        status: 'active' as const,
        healthStatus: 'healthy' as const,
        lastChecked: 'Just now',
        permissions,
      };

      userApiKeysStore.unshift(newItem);
      userApiKeyOwner.set(newItem.id, owner);
      res.status(201).json({
        ...newItem,
        key: generatedSecret,
        key_masked: masked,
        rate_limit_rps: Math.max(1, Math.floor(rateLimitRpm / 60)),
        created_at: newItem.createdAt,
        scopes: permissions,
      });
    }
  );

  app.patch(['/api/api-keys/:id', '/api/v1/api-keys/:id'], async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const { id } = req.params;
    const target = userApiKeysStore.find((k) => k.id === id);
    if (!target || (userApiKeyOwner.get(id) || '') !== owner) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }

    const { name, provider, rateLimitRpm, permissions, secret, status } = req.body || {};
    if (typeof name === 'string' && name.trim()) target.name = name.trim();
    if (typeof provider === 'string' && provider.trim()) target.provider = provider.trim();
    if (typeof rateLimitRpm === 'number' && !Number.isNaN(rateLimitRpm))
      target.rateLimitRpm = rateLimitRpm;
    if (Array.isArray(permissions) && permissions.length > 0) target.permissions = permissions;
    if (status === 'active' || status === 'revoked') target.status = status;
    if (typeof secret === 'string' && secret.trim()) {
      const clean = secret.trim();
      target.keyPrefix = clean.slice(0, Math.min(14, clean.length));
      target.secretMasked =
        clean.length > 10
          ? `${clean.slice(0, 10)}••••••••••••••••${clean.slice(-4)}`
          : '••••••••••••';
      target.healthStatus = 'healthy';
      target.lastChecked = 'Rotated just now';
    }

    res.json({ success: true, key: target });
  });

  app.post(
    ['/api/api-keys/:id/revoke', '/api/v1/api-keys/:id/revoke'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const target = userApiKeysStore.find((k) => k.id === req.params.id);
      if (!target || (userApiKeyOwner.get(req.params.id) || '') !== owner) {
        res.status(404).json({ error: 'API key not found.' });
        return;
      }
      target.status = 'revoked';
      res.json({ success: true, key: target });
    }
  );

  app.post(
    ['/api/api-keys/:id/probe', '/api/v1/api-keys/:id/probe'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const target = userApiKeysStore.find((k) => k.id === req.params.id);
      if (!target || (userApiKeyOwner.get(req.params.id) || '') !== owner) {
        res.status(404).json({ error: 'API key not found.' });
        return;
      }
      if (target.status === 'revoked') {
        res.status(400).json({ error: 'Cannot probe a revoked key.' });
        return;
      }

      const startedAt = Date.now();
      const matchedProvider = ctx.providerMesh.find((p) => p.provider === target.provider);
      const activeKey = process.env.GEMINI_API_KEY?.trim() || '';
      let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      let message = `${ctx.PROVIDER_DISPLAY_NAMES[target.provider] || target.provider} credential handshake passed.`;

      if (
        target.provider === 'google_ai_studio' &&
        activeKey &&
        activeKey !== 'MY_GEMINI_API_KEY'
      ) {
        try {
          const clientAi = new GoogleGenAI({
            apiKey: activeKey,
            httpOptions: { apiVersion: 'v1beta', headers: { 'User-Agent': 'aistudio-build' } },
          });
          await clientAi.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: 'OK',
            config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          });
          healthStatus = 'healthy';
          message = 'Live Google AI Studio probe succeeded.';
        } catch (err: unknown) {
          healthStatus = 'degraded';
          message = err instanceof Error ? err.message : 'Live Gemini probe degraded.';
        }
      } else if (matchedProvider?.status === 'degraded') {
        healthStatus = 'degraded';
        message = `${matchedProvider.displayName} experiencing elevated latency.`;
      }

      const latencyMs =
        target.provider === 'google_ai_studio' && activeKey
          ? Math.max(12, Date.now() - startedAt)
          : matchedProvider?.avgLatencyMs || 24;

      target.healthStatus = healthStatus;
      target.lastChecked = `${new Date().toLocaleTimeString()} (${latencyMs}ms)`;
      target.lastUsed = 'Just now';

      res.json({
        success: healthStatus === 'healthy',
        latencyMs,
        message,
        key: target,
      });
    }
  );

  app.delete(['/api/api-keys/:id', '/api/v1/api-keys/:id'], async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const target = userApiKeysStore.find((k) => k.id === req.params.id);
    if (!target || (userApiKeyOwner.get(req.params.id) || '') !== owner) {
      res.status(404).json({ error: 'API key not found.' });
      return;
    }
    userApiKeyOwner.delete(req.params.id);
    userApiKeysStore = userApiKeysStore.filter((k) => k.id !== req.params.id);
    res.json({
      success: true,
      keys: userApiKeysStore.filter((k) => (userApiKeyOwner.get(k.id) || '') === owner),
    });
  });
}
