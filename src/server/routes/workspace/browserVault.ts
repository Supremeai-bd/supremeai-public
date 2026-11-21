import type { Express, Request, Response } from 'express';

/**
 * Workspace Browser Vault — encrypted AES-256-GCM session snapshots
 *
 * WHY THIS FILE EXISTS
 *   Three vault routes (`GET/POST/DELETE /api/workspace/browser-vault*`)
 *   plus their in-memory store (`expressVaultStore`) lived inline in the
 *   monolith. They are cohesive (same domain-isolated vault concept, same
 *   store, same `resolveAuthenticatedEmail` auth check) and have no other
 *   consumer. Moving them shrinks the monolith with a 1-dep ctx.
 *
 * CONTRACT WITH server.ts
 *   - `app.use('/api/workspace', requireAuthMiddleware)` remains in server.ts
 *     before registration, so auth order is unchanged.
 *   - `expressVaultStore` is owned here — no other route reads it (schedules
 *     reference vaultEntryId strings only, not the map).
 *   - `resolveAuthenticatedEmail` is injected via ctx because it is a closure
 *     inside `startServer()` that closes over `customerDirectory`, `usersDb`,
 *     JWT secrets, etc. A lazy method reference avoids TDZ issues.
 */

export interface StoredExpressVaultRecord {
  id: string;
  domain: string;
  mode: 'session' | 'credentials';
  label: string;
  cookieCount?: number;
  usernameHint?: string;
  encryptedPayload: string;
  iv: string;
  algorithm: string;
  createdAt: string;
  updatedAt: string;
  ownerEmail?: string;
}

export interface WorkspaceBrowserVaultContext {
  resolveAuthenticatedEmail: (req: Request) => Promise<string | null>;
}

export function registerWorkspaceBrowserVaultRoutes(
  app: Express,
  ctx: WorkspaceBrowserVaultContext
): void {
  const expressVaultStore = new Map<string, StoredExpressVaultRecord>();

  app.get('/api/workspace/browser-vault', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const domainFilter = String(req.query.domain || '')
      .trim()
      .toLowerCase();
    const includeEncrypted = req.query.includeEncrypted === '1';
    const list = Array.from(expressVaultStore.values())
      .filter((r) => (r.ownerEmail || '') === owner)
      .filter((r) => !domainFilter || r.domain === domainFilter)
      .map((rec) => {
        if (includeEncrypted) {
          return {
            ...rec,
            hasEncryptedSecret: true,
          };
        }
        const { encryptedPayload: _ep, iv: _iv, ...meta } = rec;
        return {
          ...meta,
          hasEncryptedSecret: true,
        };
      });
    res.json({ entries: list });
  });

  app.post('/api/workspace/browser-vault', async (req: Request, res: Response) => {
    const owner = await ctx.resolveAuthenticatedEmail(req);
    if (!owner) {
      res.status(401).json({ error: 'Authentication is required.' });
      return;
    }
    const body = (req.body || {}) as Partial<StoredExpressVaultRecord>;
    if (
      typeof body.domain !== 'string' ||
      !body.domain.trim() ||
      typeof body.encryptedPayload !== 'string' ||
      typeof body.iv !== 'string'
    ) {
      res.status(400).json({ error: 'domain, encryptedPayload, and iv are required.' });
      return;
    }

    const id =
      typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `vault_${Date.now()}`;
    const existing = expressVaultStore.get(id);
    if (existing && existing.ownerEmail && existing.ownerEmail !== owner) {
      res.status(403).json({ error: 'Cannot overwrite another user vault entry.' });
      return;
    }
    const now = new Date().toISOString();
    const record: StoredExpressVaultRecord = {
      id,
      domain: body.domain.trim().toLowerCase(),
      mode: body.mode === 'credentials' ? 'credentials' : 'session',
      label: (body.label || body.domain).trim().slice(0, 64),
      cookieCount: typeof body.cookieCount === 'number' ? body.cookieCount : undefined,
      usernameHint: typeof body.usernameHint === 'string' ? body.usernameHint : undefined,
      encryptedPayload: body.encryptedPayload,
      iv: body.iv,
      algorithm: typeof body.algorithm === 'string' ? body.algorithm : 'AES-256-GCM',
      createdAt:
        typeof body.createdAt === 'string' && body.createdAt.trim()
          ? body.createdAt
          : existing?.createdAt || now,
      updatedAt: now,
      ownerEmail: owner,
    };
    expressVaultStore.set(id, record);
    console.info(
      `[BROWSER_VAULT_SAVE] id=${record.id} domain=${record.domain} mode=${record.mode}`
    );

    res.json({
      success: true,
      entry: {
        id: record.id,
        domain: record.domain,
        mode: record.mode,
        label: record.label,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        hasEncryptedSecret: true,
      },
    });
  });

  app.delete(
    ['/api/workspace/browser-vault', '/api/workspace/browser-vault/:id'],
    async (req: Request, res: Response) => {
      const owner = await ctx.resolveAuthenticatedEmail(req);
      if (!owner) {
        res.status(401).json({ error: 'Authentication is required.' });
        return;
      }
      const id = String((req.params as Record<string, string>).id || (req.query as Record<string, string>).id || '').trim();
      if (!id) {
        res.status(400).json({ error: 'id parameter is required.' });
        return;
      }
      const existing = expressVaultStore.get(id);
      if (!existing || (existing.ownerEmail || '') !== owner) {
        res.status(404).json({ error: 'Vault entry not found.' });
        return;
      }
      expressVaultStore.delete(id);
      res.json({ success: true, id });
    }
  );
}
