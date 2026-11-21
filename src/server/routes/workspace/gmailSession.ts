import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  buildGmailSessionSetCookie,
  GMAIL_SESSION_COOKIE_NAME,
  GMAIL_SESSION_TTL_SECONDS,
  parseCookieFromHeader,
  sealGmailSessionCookie,
  unsealGmailSessionCookie,
} from '../../../shared/gmailSessionCrypto';

/**
 * Workspace Gmail Session — sealed HttpOnly cookie persistence
 *
 * WHY THIS FILE EXISTS
 *   The three gmail-session handlers plus their sealing-secret helper
 *   (`getGmailSealingSecret` / `gmailSealingSecret`) lived inline in the
 *   monolith (~90 lines). They are cohesive (all operate on the same
 *   HttpOnly cookie with AES sealing) and have no other consumer.
 *
 * CONTRACT WITH server.ts
 *   - `isHttpsRequest` is injected via ctx (closure over request headers).
 *   - Shared crypto helpers are imported directly from
 *     `src/shared/gmailSessionCrypto` — no duplication.
 *   - `gmailSealingSecret` is owned here (generated once at registration).
 *   - Auth is cookie-based, not `resolveAuthenticatedEmail`, so no extra dep.
 */

export interface WorkspaceGmailSessionContext {
  isHttpsRequest: (req: Request) => boolean;
}

export function registerWorkspaceGmailSessionRoutes(
  app: Express,
  ctx: WorkspaceGmailSessionContext
): void {
  const getGmailSealingSecret = (): string => {
    const fromEnv =
      process.env.GMAIL_SESSION_SECRET?.trim() ||
      process.env.ADMIN_JWT_SECRET?.trim() ||
      process.env.SESSION_SECRET?.trim();
    if (fromEnv) return fromEnv;
    const keyFilePath = path.join(os.tmpdir(), 'supremeai_gmail_session_seal.key');
    try {
      if (fs.existsSync(keyFilePath)) {
        const existing = fs.readFileSync(keyFilePath, 'utf8').trim();
        if (existing.length >= 32) return existing;
      }
      const generated = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(keyFilePath, generated, { mode: 0o600 });
      return generated;
    } catch {
      return crypto.randomBytes(32).toString('hex');
    }
  };
  const gmailSealingSecret = getGmailSealingSecret();

  app.get('/api/workspace/gmail-session', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const rawCookie = parseCookieFromHeader(req.header('cookie'), GMAIL_SESSION_COOKIE_NAME);
    if (!rawCookie) {
      res.status(401).json({ authenticated: false });
      return;
    }
    const payload = await unsealGmailSessionCookie(rawCookie, gmailSealingSecret);
    if (!payload) {
      res.setHeader('Set-Cookie', buildGmailSessionSetCookie('', 0, ctx.isHttpsRequest(req)));
      res.status(401).json({ authenticated: false });
      return;
    }
    const requestedUid = String(req.query.uid || '').trim();
    if (requestedUid && payload.uid && payload.uid !== requestedUid) {
      res.status(401).json({ authenticated: false });
      return;
    }
    res.json({
      authenticated: true,
      accessToken: payload.accessToken,
      email: payload.email,
      uid: payload.uid,
      expiresAt: payload.exp,
    });
  });

  app.post('/api/workspace/gmail-session', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = (req.body || {}) as { accessToken?: string; uid?: string; email?: string };
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken.trim() : '';
    if (!accessToken) {
      res.status(400).json({ error: 'accessToken is required.' });
      return;
    }
    const sealed = await sealGmailSessionCookie(
      {
        accessToken,
        uid: typeof body.uid === 'string' ? body.uid.trim() : '',
        email: typeof body.email === 'string' ? body.email.trim() : '',
      },
      gmailSealingSecret
    );
    if (!sealed) {
      res.status(500).json({ error: 'Session encryption unavailable.' });
      return;
    }
    res.setHeader(
      'Set-Cookie',
      buildGmailSessionSetCookie(sealed, GMAIL_SESSION_TTL_SECONDS, ctx.isHttpsRequest(req))
    );
    res.json({
      ok: true,
      expiresAt: Date.now() + GMAIL_SESSION_TTL_SECONDS * 1000,
    });
  });

  app.delete('/api/workspace/gmail-session', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', buildGmailSessionSetCookie('', 0, ctx.isHttpsRequest(req)));
    res.json({ ok: true });
  });
}
